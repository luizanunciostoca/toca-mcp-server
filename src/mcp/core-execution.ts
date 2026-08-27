import { randomUUID } from 'node:crypto';
import type { AuditEvent, AuditSink } from '../core/audit.js';
import type { AutonomyRuntimeContextResolver } from '../core/autonomy-runtime-context.js';
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

export interface CoreCapabilityRuntimeContext {
  readonly identity: ExecutionIdentity;
  readonly executionId: string;
  readonly correlationId: string;
}

export interface CoreCapabilityRuntimeBinding {
  readonly inputSchema: CoreInputParser;
  execute(input: unknown, context?: CoreCapabilityRuntimeContext): Promise<unknown>;
  readonly targetAccount?: (input: unknown) => string | undefined;
  readonly idempotencyKey?: (input: unknown) => string | undefined;
  readonly financialContext?: (input: unknown) => CoreCapabilityFinancialContext | undefined;
  readonly providerReadback?: (result: unknown, input: unknown) => Promise<ProviderReadbackResult>;
  readonly sideEffectValidated?: boolean;
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
  readonly autonomyContextResolver?: AutonomyRuntimeContextResolver;
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

export interface ResolvedRuntimeExecution {
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
  const resolved = resolveCoreRuntimeExecution(
    input.capabilityId,
    input.payload,
    identity,
    dependencies,
  );
  const correlationId = requireText(input.correlationId, 'CORE_CORRELATION_ID_REQUIRED');

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
  let providerReadbackEvidence: readonly string[] = [];
  let providerExternalResourceId: string | undefined;
  const descriptorEvidence = `core:descriptor-sha256:${resolved.descriptorSha256}`;
  const providerReadback = resolved.binding.providerReadback
    ? async (result: unknown): Promise<ProviderReadbackResult> => {
        const readback = await resolved.binding.providerReadback!(result, resolved.payload);
        const providerEvidence = normalizeEvidence(readback.evidence);
        const externalResourceId = normalizeOptional(readback.externalResourceId);
        const verified =
          readback.verified && providerEvidence.length > 0 && externalResourceId !== undefined;
        providerReadbackVerified = verified;
        providerReadbackEvidence = [
          `provider:readback:${resolved.capabilityId}`,
          ...providerEvidence,
        ];
        providerExternalResourceId = externalResourceId;
        const reason =
          readback.reason ??
          (providerEvidence.length === 0
            ? 'PROVIDER_READBACK_EVIDENCE_REQUIRED'
            : !externalResourceId
              ? 'PROVIDER_READBACK_RESOURCE_ID_REQUIRED'
              : undefined);
        return {
          ...readback,
          verified,
          evidence: providerReadbackEvidence,
          ...(externalResourceId ? { externalResourceId } : {}),
          ...(!verified && reason ? { reason } : {}),
        };
      }
    : undefined;

  const autonomyContext = dependencies.autonomyContextResolver
    ? await dependencies.autonomyContextResolver({ tool: resolved.tool, identity })
    : undefined;
  const policyContext = {
    identity,
    ...(resolved.targetAccount ? { connectedAccount: resolved.targetAccount } : {}),
    descriptorSha256: resolved.descriptorSha256,
    ...(resolved.idempotencyKey ? { idempotencyKey: resolved.idempotencyKey } : {}),
    requiredApprovalScope: [resolved.capabilityId],
    ...(autonomyContext ?? {}),
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
    const result = await resolved.binding.execute(resolved.payload, {
      identity,
      executionId,
      correlationId,
    });
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

  const auditSink = createBoundAuditSink(dependencies.auditSink, () => ({
    descriptorEvidence,
    providerReadbackEvidence,
    providerExternalResourceId,
  }));
  const result = await executeTool({
    tool: resolved.tool,
    policyContext,
    auditSink,
    correlationId,
    action,
    ...(approvalExecution ? { approvalExecution } : {}),
    createExecutionId: () => executionId,
    enforceOperationalReadiness: Boolean(dependencies.autonomyContextResolver),
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
  const resolved = resolveCoreRuntimeExecution(input.capabilityId, input.payload, identity, {
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
  readonly identity: ExecutionIdentity;
  readonly targetAccount?: string;
  readonly idempotencyKey?: string;
  readonly financialContext?: CoreCapabilityFinancialContext;
}): Readonly<Record<string, unknown>> {
  return {
    schema_version: 2,
    capability_id: requireText(input.capabilityId, 'CAPABILITY_ID_REQUIRED'),
    requester_binding: {
      principal_id: input.identity.principal.principalId,
      tenant_id: input.identity.principal.tenantId,
      workspace_id: input.identity.principal.workspaceId,
      organization_id: input.identity.principal.organizationId,
    },
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

export function resolveCoreRuntimeExecution(
  requestedCapabilityId: string,
  payload: unknown,
  identity: ExecutionIdentity,
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
  assertRuntimeContract(tool, resolvedDefinition.canonical_definition);
  if (tool.sideEffects && binding.sideEffectValidated !== true) {
    throw unavailable(
      'CAPABILITY_RUNTIME_BINDING_UNVALIDATED',
      `Side-effect runtime binding for ${capabilityId} has not been explicitly validated for execution.`,
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
    identity,
    ...(targetAccount ? { targetAccount } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(financialContext ? { financialContext } : {}),
  });
  const resolved: ResolvedRuntimeExecution = {
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
  assertAuthorized(identity, resolved);
  return resolved;
}

function assertRuntimeContract(
  tool: ToolDefinition,
  canonical: NonNullable<ReturnType<typeof resolveCapabilityDefinition>>['canonical_definition'],
): void {
  const formalApproval = requiresFormalApproval(tool);
  const mismatches: string[] = [];
  if (tool.riskClass !== canonical.risk_class) mismatches.push('risk_class');
  if (tool.sideEffects !== canonical.side_effects) mismatches.push('side_effects');
  if (tool.capabilityStatus !== canonical.lifecycle_status) mismatches.push('lifecycle_status');
  if (tool.idempotent !== canonical.idempotent) mismatches.push('idempotent');
  if (formalApproval !== canonical.approval_required) mismatches.push('approval_required');
  if (mismatches.length > 0) {
    throw unavailable(
      'CAPABILITY_RUNTIME_CONTRACT_MISMATCH',
      `Runtime contract for ${tool.name} diverges from canonical fields: ${mismatches.join(',')}.`,
    );
  }
}

function assertAuthorized(identity: ExecutionIdentity, resolved: ResolvedRuntimeExecution): void {
  const capability = resolveCapabilityDefinition(resolved.capabilityId)?.canonical_definition;
  const routeId = capability?.primary_route_id ?? capability?.route_id;
  const authorization = authorizeExecution(identity, {
    capabilityId: resolved.capabilityId,
    riskClass: resolved.tool.riskClass,
    ...(routeId && routeId !== 'TRANSVERSAL' ? { routeId } : {}),
    ...(resolved.targetAccount ? { targetAccount: resolved.targetAccount } : {}),
  });
  if (!authorization.allowed) {
    throw new ExecutionError('POLICY_DENIED', authorization.reason);
  }
}

function createBoundAuditSink(
  sink: AuditSink,
  state: () => {
    readonly descriptorEvidence: string;
    readonly providerReadbackEvidence: readonly string[];
    readonly providerExternalResourceId: string | undefined;
  },
): AuditSink {
  return {
    async write(event: AuditEvent): Promise<void> {
      const current = state();
      const evidence = normalizeEvidence([
        ...(event.evidence ?? []),
        current.descriptorEvidence,
        ...current.providerReadbackEvidence,
      ]);
      await sink.write({
        ...event,
        evidence,
        ...(!event.externalResourceId && current.providerExternalResourceId
          ? { externalResourceId: current.providerExternalResourceId }
          : {}),
      });
    },
  };
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
