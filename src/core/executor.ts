import { randomUUID } from 'node:crypto';
import type { AuditEvent, AuditSink } from './audit.js';
import { evaluateAutonomyGate } from './autonomy-gate.js';
import { ExecutionError } from './errors.js';
import {
  approvalExpectationFromPolicy,
  requiresFormalApproval,
  type PolicyContext,
} from './policy.js';
import type { ToolDefinition } from './tool-registry.js';
import type { ApprovalAtomicTransition, ApprovalStore } from '../governance/approval-governance.js';

export interface ProviderReadbackResult {
  readonly verified: boolean;
  readonly evidence: readonly string[];
  readonly reason?: string;
  readonly externalResourceId?: string;
}

export interface ApprovalExecutionOptions<T> {
  readonly approvalId: string;
  readonly store: ApprovalStore;
  readonly providerReadback: (result: T) => Promise<ProviderReadbackResult>;
  readonly now?: () => string;
}

export interface ExecuteToolOptions<T> {
  readonly tool: ToolDefinition;
  readonly policyContext: PolicyContext;
  readonly auditSink: AuditSink;
  readonly correlationId: string;
  readonly action: () => Promise<T>;
  readonly approvalExecution?: ApprovalExecutionOptions<T>;
  readonly createExecutionId?: () => string;
  readonly enforceOperationalReadiness?: boolean;
}

function createAuditEvent<T>(
  options: ExecuteToolOptions<T>,
  policyContext: PolicyContext,
  executionId: string,
  status: AuditEvent['status'],
  extra: Partial<Pick<AuditEvent, 'errorCode' | 'externalResourceId' | 'evidence'>> = {},
): AuditEvent {
  const principal = policyContext.identity?.principal;
  const authorization = policyContext.identity?.authorization;
  return {
    executionId,
    correlationId: options.correlationId,
    toolName: options.tool.name,
    requester: principal?.principalId ?? policyContext.requester ?? 'anonymous',
    ...(principal
      ? {
          principalType: principal.principalType,
          tenantId: principal.tenantId,
          workspaceId: principal.workspaceId,
          organizationId: principal.organizationId,
          ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
          authenticationMethod: principal.authenticationMethod,
        }
      : {}),
    ...(authorization ? { authorizationRoles: authorization.roles } : {}),
    status,
    createdAt: new Date().toISOString(),
    ...(policyContext.approval ? { approvalId: policyContext.approval.approvalId } : {}),
    ...(policyContext.connectedAccount ? { connectedAccount: policyContext.connectedAccount } : {}),
    ...extra,
  };
}

export async function executeTool<T>(options: ExecuteToolOptions<T>): Promise<T> {
  const executionId = options.createExecutionId?.() ?? randomUUID();
  let policyContext = options.policyContext;
  const formalApproval = requiresFormalApproval(options.tool);

  if (formalApproval && options.approvalExecution) {
    const storedApproval = await options.approvalExecution.store.get(
      options.approvalExecution.approvalId,
    );
    if (storedApproval) policyContext = { ...policyContext, approval: storedApproval };
  }

  const effectiveOptions = { ...options, policyContext } satisfies ExecuteToolOptions<T>;
  const policy = evaluateAutonomyGate(options.tool, policyContext, {
    enforceOperationalReadiness: options.enforceOperationalReadiness ?? false,
  });

  if (policy.decision === 'REQUIRE_APPROVAL') {
    await options.auditSink.write(
      createAuditEvent(effectiveOptions, policyContext, executionId, 'DENIED', {
        errorCode: 'APPROVAL_REQUIRED',
        evidence: [...policy.evidence, `autonomy:reason:${policy.reasonCode}`],
      }),
    );
    throw new ExecutionError('APPROVAL_REQUIRED', `${policy.reasonCode}: ${policy.reason}`);
  }

  if (policy.decision === 'DENY') {
    await options.auditSink.write(
      createAuditEvent(effectiveOptions, policyContext, executionId, 'DENIED', {
        errorCode: 'POLICY_DENIED',
        evidence: [...policy.evidence, `autonomy:reason:${policy.reasonCode}`],
      }),
    );
    throw new ExecutionError('POLICY_DENIED', `${policy.reasonCode}: ${policy.reason}`);
  }

  if (formalApproval) {
    const approvalExecution = options.approvalExecution;
    if (!approvalExecution) {
      await options.auditSink.write(
        createAuditEvent(effectiveOptions, policyContext, executionId, 'DENIED', {
          errorCode: 'APPROVAL_ATOMICITY_REQUIRED',
        }),
      );
      throw new ExecutionError(
        'APPROVAL_ATOMICITY_REQUIRED',
        'Formal approval writes require an ApprovalStore reservation and provider readback contract.',
      );
    }
    return executeWithAtomicApproval(
      { ...effectiveOptions, approvalExecution },
      policyContext,
      executionId,
    );
  }

  await options.auditSink.write(
    createAuditEvent(effectiveOptions, policyContext, executionId, 'STARTED', {
      evidence: [...policy.evidence, `autonomy:reason:${policy.reasonCode}`],
    }),
  );

  try {
    const result = await options.action();
    await options.auditSink.write(
      createAuditEvent(effectiveOptions, policyContext, executionId, 'SUCCEEDED'),
    );
    return result;
  } catch (error) {
    const normalized = normalizeExecutionError(error);
    await options.auditSink.write(
      createAuditEvent(effectiveOptions, policyContext, executionId, 'FAILED', {
        errorCode: normalized.code,
      }),
    );
    throw normalized;
  }
}

async function executeWithAtomicApproval<T>(
  options: ExecuteToolOptions<T> & { readonly approvalExecution: ApprovalExecutionOptions<T> },
  policyContext: PolicyContext,
  executionId: string,
): Promise<T> {
  const approvalExecution = options.approvalExecution;
  const expectation = approvalExpectationFromPolicy(options.tool, policyContext);
  const principalId = policyContext.identity?.principal.principalId;
  if (!expectation || !principalId) {
    throw new ExecutionError(
      'APPROVAL_ATOMICITY_REQUIRED',
      'Approval expectation and authenticated principal are required for atomic execution.',
    );
  }

  const now = () => approvalExecution.now?.() ?? new Date().toISOString();
  const reserve: ApprovalAtomicTransition = {
    type: 'RESERVE',
    expectation,
    binding: {
      executionId,
      principalId,
      correlationId: options.correlationId,
    },
    now: now(),
  };

  try {
    await approvalExecution.store.transition(approvalExecution.approvalId, reserve);
  } catch (error) {
    await options.auditSink.write(
      createAuditEvent(options, policyContext, executionId, 'DENIED', {
        errorCode: 'DUPLICATE_PREVENTED',
      }),
    );
    throw new ExecutionError(
      'DUPLICATE_PREVENTED',
      `Approval reservation failed: ${errorMessage(error)}`,
    );
  }

  try {
    await options.auditSink.write(createAuditEvent(options, policyContext, executionId, 'STARTED'));
  } catch (error) {
    await bestEffortTransition(approvalExecution.store, approvalExecution.approvalId, {
      type: 'RELEASE',
      executionId,
      reason: 'AUDIT_START_FAILED_BEFORE_PROVIDER_EXECUTION',
      evidence: [`audit:start-failed:${executionId}`],
      now: now(),
    });
    throw error;
  }

  try {
    await approvalExecution.store.transition(approvalExecution.approvalId, {
      type: 'BEGIN_EXECUTION',
      executionId,
      evidence: [`execution:started:${executionId}`],
      now: now(),
    });
  } catch (error) {
    await bestEffortTransition(approvalExecution.store, approvalExecution.approvalId, {
      type: 'RELEASE',
      executionId,
      reason: 'EXECUTION_STATE_NOT_STARTED',
      evidence: [`execution:begin-failed:${executionId}`],
      now: now(),
    });
    await options.auditSink.write(
      createAuditEvent(options, policyContext, executionId, 'FAILED', {
        errorCode: 'STATE_CONFLICT',
      }),
    );
    throw new ExecutionError(
      'STATE_CONFLICT',
      `Approval execution could not start: ${errorMessage(error)}`,
    );
  }

  let result: T;
  try {
    result = await options.action();
  } catch (error) {
    const normalized = normalizeExecutionError(error);
    await bestEffortTransition(approvalExecution.store, approvalExecution.approvalId, {
      type: 'FAIL_REVIEW_REQUIRED',
      executionId,
      reason: `PROVIDER_EXECUTION_ERROR:${normalized.code}`,
      evidence: [`provider:execution-error:${normalized.code}:${executionId}`],
      now: now(),
    });
    await options.auditSink.write(
      createAuditEvent(options, policyContext, executionId, 'FAILED', {
        errorCode: 'APPROVAL_REVIEW_REQUIRED',
      }),
    );
    throw new ExecutionError(
      'APPROVAL_REVIEW_REQUIRED',
      'Provider execution began but did not complete cleanly. Automatic retry is blocked pending review.',
    );
  }

  let readback: ProviderReadbackResult;
  try {
    readback = await approvalExecution.providerReadback(result);
  } catch (error) {
    await failReadbackReview(
      approvalExecution.store,
      approvalExecution.approvalId,
      executionId,
      `PROVIDER_READBACK_ERROR:${errorMessage(error)}`,
      [`provider:readback-error:${executionId}`],
      now(),
    );
    await options.auditSink.write(
      createAuditEvent(options, policyContext, executionId, 'FAILED', {
        errorCode: 'PROVIDER_READBACK_FAILED',
      }),
    );
    throw new ExecutionError(
      'APPROVAL_REVIEW_REQUIRED',
      'Provider side effect may have occurred, but provider readback failed. Automatic retry is blocked.',
    );
  }

  if (!readback.verified || readback.evidence.filter((item) => item.trim()).length === 0) {
    const reason = readback.reason?.trim() || 'PROVIDER_READBACK_NOT_VERIFIED';
    await failReadbackReview(
      approvalExecution.store,
      approvalExecution.approvalId,
      executionId,
      reason,
      readback.evidence.length > 0
        ? readback.evidence
        : [`provider:readback-not-verified:${executionId}`],
      now(),
    );
    await options.auditSink.write(
      createAuditEvent(options, policyContext, executionId, 'FAILED', {
        errorCode: 'PROVIDER_READBACK_FAILED',
        ...(readback.externalResourceId ? { externalResourceId: readback.externalResourceId } : {}),
      }),
    );
    throw new ExecutionError(
      'APPROVAL_REVIEW_REQUIRED',
      'Provider readback did not prove the expected state. Automatic retry is blocked.',
    );
  }

  try {
    await approvalExecution.store.transition(approvalExecution.approvalId, {
      type: 'PROVIDER_READBACK',
      executionId,
      evidence: readback.evidence,
      now: now(),
    });
  } catch (error) {
    await bestEffortTransition(approvalExecution.store, approvalExecution.approvalId, {
      type: 'FAIL_REVIEW_REQUIRED',
      executionId,
      reason: `READBACK_PERSISTENCE_FAILED:${errorMessage(error)}`,
      evidence: [...readback.evidence, `approval:readback-persist-failed:${executionId}`],
      now: now(),
    });
    await options.auditSink.write(
      createAuditEvent(options, policyContext, executionId, 'FAILED', {
        errorCode: 'APPROVAL_REVIEW_REQUIRED',
        ...(readback.externalResourceId ? { externalResourceId: readback.externalResourceId } : {}),
      }),
    );
    throw new ExecutionError(
      'APPROVAL_REVIEW_REQUIRED',
      'Provider state was read back but the approval lifecycle could not persist the readback.',
    );
  }

  try {
    await approvalExecution.store.transition(approvalExecution.approvalId, {
      type: 'CONSUME',
      executionId,
      evidence: [`approval:consumed-after-readback:${executionId}`],
      now: now(),
    });
  } catch (error) {
    await options.auditSink.write(
      createAuditEvent(options, policyContext, executionId, 'FAILED', {
        errorCode: 'APPROVAL_REVIEW_REQUIRED',
        ...(readback.externalResourceId ? { externalResourceId: readback.externalResourceId } : {}),
      }),
    );
    throw new ExecutionError(
      'APPROVAL_REVIEW_REQUIRED',
      `Provider readback succeeded, but approval consumption persistence failed: ${errorMessage(error)}`,
    );
  }

  await options.auditSink.write(
    createAuditEvent(options, policyContext, executionId, 'SUCCEEDED', {
      ...(readback.externalResourceId ? { externalResourceId: readback.externalResourceId } : {}),
    }),
  );
  return result;
}

async function failReadbackReview(
  store: ApprovalStore,
  approvalId: string,
  executionId: string,
  reason: string,
  evidence: readonly string[],
  now: string,
): Promise<void> {
  await bestEffortTransition(store, approvalId, {
    type: 'FAIL_REVIEW_REQUIRED',
    executionId,
    reason,
    evidence,
    now,
  });
}

async function bestEffortTransition(
  store: ApprovalStore,
  approvalId: string,
  transition: ApprovalAtomicTransition,
): Promise<void> {
  try {
    await store.transition(approvalId, transition);
  } catch {
    // The current lifecycle state already remains fail-closed; never mask the primary failure.
  }
}

function normalizeExecutionError(error: unknown): ExecutionError {
  return error instanceof ExecutionError
    ? error
    : new ExecutionError('PROVIDER_UNAVAILABLE', 'Tool execution failed.', true);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_ERROR';
}
