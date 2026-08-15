import { randomUUID } from 'node:crypto';
import type { AuditSink } from '../core/audit.js';
import { executeTool, type ProviderReadbackResult } from '../core/executor.js';
import { ExecutionError } from '../core/errors.js';
import { authorizeExecution, type ExecutionIdentity } from '../core/identity.js';
import { requiresFormalApproval } from '../core/policy.js';
import type { ToolDefinition, ToolRegistry } from '../core/tool-registry.js';
import {
  hashApprovalDescriptor,
  requestApproval,
  type ApprovalFinancialCeiling,
  type ApprovalRecord,
  type ApprovalStore,
} from '../governance/approval-governance.js';
import { resolveCapabilityDefinition } from '../governance/capability-resolution.js';

export interface CoreInputParser {
  parse(value: unknown): unknown;
}

export interface CoreCapabilityFinancialContext {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface CoreCapabilityRuntimeBinding {
  readonly inputSchema: CoreInputParser;
  execute(input: unknown): Promise<unknown>;
  readonly targetAccount?: (input: unknown) => string | undefined;
  readonly idempotencyKey?: (input: unknown) => string | undefined;
  readonly financialContext?: (input: unknown) => CoreCapabilityFinancialContext | undefined;
  readonly providerReadback?: (result: unknown, input: unknown) => Promise<ProviderReadbackResult>;
}

export type CoreCapabilityRuntimeResolver = (
  capabilityId: string,
) => CoreCapabilityRuntimeBinding | undefined;

export interface CoreExecutionDependencies {
  readonly registry: ToolRegistry;
  readonly runtimeResolver: CoreCapabilityRuntimeResolver;
  readonly auditSink: AuditSink;
  readonly approvalStore?: ApprovalStore;
  readonly createExecutionId?: () => string;
}

export interface CoreExecuteInput {
  readonly capabilityId: string;
  readonly payload: unknown;
  readonly correlationId: string;
  readonly approvalId?: string;
}

export interface CoreExecuteResult {
  readonly executionId: string;
  readonly correlationId: string;
  readonly capabilityId: string;
  readonly result: unknown;
  readonly providerReadbackVerified: boolean;
}

export interface CoreApprovalRequestInput {
  readonly capabilityId: string;
  readonly payload: unknown;
  readonly correlationId: string;
  readonly expiresAt: string;
  readonly evidence: readonly string[];
}

interface ResolvedRuntimeExecution {
  readonly capabilityId: string;
  readonly tool: ToolDefinition;
  readonly binding: CoreCapabilityRuntimeBinding;
  readonly payload: unknown;
  readonly targetAccount: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly financialContext: CoreCapabilityFinancialContext | undefined;
  readonly descriptor: Readonly<Record<string, unknown>>;
  readonly descriptorSha256: string;
}

export async function executeCoreCapability(
  input: CoreExecuteInput,
  identity: ExecutionIdentity,
  dependencies: CoreExecutionDependencies,
): Promise<CoreExecuteResult> {
  const resolved = resolveRuntimeExecution(input.capabilityId, input.payload, dependencies);
  const correlationId = requireText(input.correlationId, 'CORE_CORRELATION_ID_REQUIRED');
  assertAuthorized(identity, resolved);

  if (resolved.tool.sideEffects && !resolved.idempotencyKey) {
    throw unavailable(
      'IDEMPOTENCY_KEY_REQUIRED',
      `Side-effect capability ${resolved.capabilityId} has no deterministic idempotency binding.`,
    );
  }
  if (resolved.tool.sideEffects && !resolved.binding.providerReadback) {
    throw unavailable(
      'PROVIDER_READBACK_REQUIRED',
      `Side-effect capability ${resolved.capabilityId} has no provider read-back binding.`,
    );
  }
  if (requiresFormalApproval(resolved.tool) && !resolved.targetAccount) {
    throw unavailable(
      'TARGET_ACCOUNT_REQUIRED',
      `Formal-approval capability ${resolved.capabilityId} must resolve a target account.`,
    );
  }

  const executionId = dependencies.createExecutionId?.() ?? randomUUID();
  let providerReadbackVerified = !resolved.tool.sideEffects;
  const providerReadback = resolved.binding.providerReadback
    ? async (result: unknown): Promise<ProviderReadbackResult> => {
        const readback = await resolved.binding.providerReadback?.(result, resolved.payload);
        if (!readback) {
          return {
            verified: false,
            evidence: [`provider:readback:${resolved.capabilityId}`],
            reason: 'PROVIDER_READBACK_MISSING',
          };
        }
        const providerEvidence = normalizeEvidence(readback.evidence);
        const verified = readback.verified && providerEvidence.length > 0;
        providerReadbackVerified = verified;
        return {
          ...readback,
          verified,
          evidence: [`provider:readback:${resolved.capabilityId}`, ...providerEvidence],
          ...(!verified && !readback.reason
            ? { reason: 'PROVIDER_READBACK_EVIDENCE_REQUIRED' }
            : {}),
        };
      }
    : undefined;

  const policyContext = {
    identity,
    ...(resolved.targetAccount ? { connectedAccount: resolved.targetAccount } : {}),
    descriptorSha256: resolved.descriptorSha256,
    requiredApprovalScope: [resolved.capabilityId],
    ...(resolved.financialContext
      ? {
          financialAmountMinor: resolved.financialContext.amountMinor,
          currency: resolved.financialContext.currency,
        }
      : {}),
  };

  const formalApproval = requiresFormalApproval(resolved.tool);
  const approvalExecution =
    formalApproval && input.approvalId && dependencies.approvalStore && providerReadback
      ? {
          approvalId: input.approvalId,
          store: dependencies.approvalStore,
          providerReadback,
        }
      : undefined;

  const action = async (): Promise<unknown> => {
    const result = await resolved.binding.execute(resolved.payload);
    if (resolved.tool.sideEffects && !formalApproval) {
      if (!providerReadback) {
        throw new ExecutionError(
          'PROVIDER_READBACK_FAILED',
          'Provider read-back is required for every side effect.',
        );
      }
      const readback = await providerReadback(result);
      if (!readback.verified) {
        throw new ExecutionError(
          'PROVIDER_READBACK_FAILED',
          readback.reason ?? 'Provider read-back did not verify the expected state.',
        );
      }
    }
    return result;
  };

  const result = await executeTool({
    tool: resolved.tool,
    policyContext,
    auditSink: dependencies.auditSink,
    correlationId,
    action,
    ...(approvalExecution ? { approvalExecution } : {}),
    createExecutionId: () => executionId,
  });

  return {
    executionId,
    correlationId,
    capabilityId: resolved.capabilityId,
    result,
    providerReadbackVerified,
  };
}

export async function requestCoreApproval(
  input: CoreApprovalRequestInput,
  identity: ExecutionIdentity,
  dependencies: Pick<CoreExecutionDependencies, 'registry' | 'runtimeResolver' | 'approvalStore'>,
): Promise<ApprovalRecord> {
  if (!dependencies.approvalStore)
    throw unavailable('APPROVAL_STORE_REQUIRED', 'Approval persistence is unavailable.');
  const resolved = resolveRuntimeExecution(input.capabilityId, input.payload, {
    registry: dependencies.registry,
    runtimeResolver: dependencies.runtimeResolver,
  });
  if (!requiresFormalApproval(resolved.tool)) {
    throw unavailable(
      'APPROVAL_NOT_REQUIRED',
      `Capability ${resolved.capabilityId} does not use a formal ApprovalRecord.`,
    );
  }
  if (resolved.tool.capabilityStatus !== 'PRODUCTION_VALIDATED') {
    throw new ExecutionError(
      'POLICY_DENIED',
      `Capability ${resolved.capabilityId} is not production validated.`,
    );
  }
  if (!resolved.targetAccount) {
    throw unavailable('TARGET_ACCOUNT_REQUIRED', 'Approval target account could not be resolved.');
  }
  if (!resolved.idempotencyKey) {
    throw unavailable(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Approval cannot bind an execution without idempotency.',
    );
  }
  assertAuthorized(identity, resolved);

  const capability = resolveCapabilityDefinition(resolved.capabilityId)?.canonical_definition;
  const routeId = capability?.primary_route_id ?? capability?.route_id;
  if (!routeId || routeId === 'TRANSVERSAL') {
    throw unavailable('APPROVAL_ROUTE_REQUIRED', 'Approval route could not be resolved.');
  }

  const financialCeiling: ApprovalFinancialCeiling | null = resolved.financialContext
    ? {
        amountMinor: resolved.financialContext.amountMinor,
        currency: resolved.financialContext.currency.toUpperCase(),
      }
    : null;
  const record = requestApproval({
    requester: identity.principal.principalId,
    routeId,
    capabilityId: resolved.capabilityId,
    descriptor: resolved.descriptor,
    targetAccount: resolved.targetAccount,
    scope: [resolved.capabilityId],
    financialCeiling,
    expiresAt: requireText(input.expiresAt, 'APPROVAL_EXPIRY_REQUIRED'),
    evidence: normalizeEvidence(input.evidence),
    correlationId: requireText(input.correlationId, 'CORE_CORRELATION_ID_REQUIRED'),
  });
  await dependencies.approvalStore.put(record);
  return record;
}

export function createExecutionApprovalDescriptor(input: {
  readonly capabilityId: string;
  readonly payload: unknown;
  readonly targetAccount?: string;
  readonly idempotencyKey?: string;
  readonly financialContext?: CoreCapabilityFinancialContext;
}): Readonly<Record<string, unknown>> {
  return {
    schema_version: 1,
    capability_id: requireText(input.capabilityId, 'CAPABILITY_ID_REQUIRED'),
    payload: input.payload,
    target_account: input.targetAccount ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    financial_context: input.financialContext
      ? {
          amount_minor: input.financialContext.amountMinor,
          currency: input.financialContext.currency.toUpperCase(),
        }
      : null,
  };
}

function resolveRuntimeExecution(
  requestedCapabilityId: string,
  payload: unknown,
  dependencies: Pick<CoreExecutionDependencies, 'registry' | 'runtimeResolver'>,
): ResolvedRuntimeExecution {
  const requestedId = requireText(requestedCapabilityId, 'CAPABILITY_ID_REQUIRED');
  const resolvedDefinition = resolveCapabilityDefinition(requestedId);
  if (!resolvedDefinition) {
    throw unavailable('CAPABILITY_UNKNOWN', `Capability ${requestedId} is not catalogued.`);
  }
  const capabilityId = resolvedDefinition.canonical_id;
  const tool = dependencies.registry.get(capabilityId);
  const binding = dependencies.runtimeResolver(capabilityId);
  if (!tool || !binding) {
    throw unavailable(
      'CAPABILITY_NOT_EXECUTABLE',
      `Capability ${capabilityId} is catalogued but has no active runtime binding.`,
    );
  }
  const canonical = resolvedDefinition.canonical_definition;
  if (tool.riskClass !== canonical.risk_class || tool.sideEffects !== canonical.side_effects) {
    throw unavailable(
      'CAPABILITY_RUNTIME_CONTRACT_MISMATCH',
      `Runtime contract for ${capabilityId} does not match the canonical capability catalog.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = binding.inputSchema.parse(payload);
  } catch {
    throw unavailable(
      'CAPABILITY_INPUT_INVALID',
      `Payload does not satisfy the typed runtime schema for ${capabilityId}.`,
    );
  }

  const targetAccount = normalizeOptional(binding.targetAccount?.(parsed));
  const idempotencyKey = normalizeOptional(binding.idempotencyKey?.(parsed));
  const financialContext = binding.financialContext?.(parsed);
  if (financialContext) validateFinancialContext(financialContext);
  const descriptor = createExecutionApprovalDescriptor({
    capabilityId,
    payload: parsed,
    ...(targetAccount ? { targetAccount } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(financialContext ? { financialContext } : {}),
  });

  return {
    capabilityId,
    tool,
    binding,
    payload: parsed,
    targetAccount,
    idempotencyKey,
    financialContext,
    descriptor,
    descriptorSha256: hashApprovalDescriptor(descriptor),
  };
}

function assertAuthorized(identity: ExecutionIdentity, resolved: ResolvedRuntimeExecution): void {
  const capability = resolveCapabilityDefinition(resolved.capabilityId)?.canonical_definition;
  const routeId = capability?.primary_route_id ?? capability?.route_id;
  const authorization = authorizeExecution(identity, {
    capabilityId: resolved.capabilityId,
    riskClass: resolved.tool.riskClass,
    ...(routeId && routeId !== 'TRANSVERSAL' ? { routeId } : {}),
    ...(resolved.tool.sideEffects && resolved.targetAccount
      ? { targetAccount: resolved.targetAccount }
      : {}),
  });
  if (!authorization.allowed) {
    throw new ExecutionError('POLICY_DENIED', authorization.reason);
  }
}

function validateFinancialContext(value: CoreCapabilityFinancialContext): void {
  if (!Number.isInteger(value.amountMinor) || value.amountMinor < 0) {
    throw unavailable(
      'FINANCIAL_AMOUNT_INVALID',
      'Financial amount must be a non-negative integer.',
    );
  }
  if (!/^[A-Z]{3}$/.test(value.currency.toUpperCase())) {
    throw unavailable(
      'FINANCIAL_CURRENCY_INVALID',
      'Financial currency must be a three-letter code.',
    );
  }
}

function normalizeEvidence(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw unavailable(errorCode, errorCode);
  return normalized;
}

function unavailable(code: string, message: string): ExecutionError {
  return new ExecutionError('CAPABILITY_UNAVAILABLE', `${code}: ${message}`);
}
