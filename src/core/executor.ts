import { randomUUID } from 'node:crypto';
import type { AuditEvent, AuditSink } from './audit.js';
import { ExecutionError } from './errors.js';
import { evaluatePolicy, type PolicyContext } from './policy.js';
import type { ToolDefinition } from './tool-registry.js';

export interface ExecuteToolOptions<T> {
  readonly tool: ToolDefinition;
  readonly policyContext: PolicyContext;
  readonly auditSink: AuditSink;
  readonly correlationId: string;
  readonly action: () => Promise<T>;
}

function createAuditEvent(
  options: ExecuteToolOptions<unknown>,
  executionId: string,
  status: AuditEvent['status'],
  extra: Partial<Pick<AuditEvent, 'errorCode' | 'externalResourceId'>> = {},
): AuditEvent {
  return {
    executionId,
    correlationId: options.correlationId,
    toolName: options.tool.name,
    requester: options.policyContext.requester,
    status,
    createdAt: new Date().toISOString(),
    ...(options.policyContext.connectedAccount
      ? { connectedAccount: options.policyContext.connectedAccount }
      : {}),
    ...extra,
  };
}

export async function executeTool<T>(options: ExecuteToolOptions<T>): Promise<T> {
  const executionId = randomUUID();
  const policy = evaluatePolicy(options.tool, options.policyContext);

  if (policy.decision === 'REQUIRE_APPROVAL') {
    await options.auditSink.write(
      createAuditEvent(options, executionId, 'DENIED', {
        errorCode: 'APPROVAL_REQUIRED',
      }),
    );
    throw new ExecutionError('APPROVAL_REQUIRED', policy.reason);
  }

  if (policy.decision === 'DENY') {
    await options.auditSink.write(
      createAuditEvent(options, executionId, 'DENIED', {
        errorCode: 'POLICY_DENIED',
      }),
    );
    throw new ExecutionError('POLICY_DENIED', policy.reason);
  }

  await options.auditSink.write(createAuditEvent(options, executionId, 'STARTED'));

  try {
    const result = await options.action();
    await options.auditSink.write(createAuditEvent(options, executionId, 'SUCCEEDED'));
    return result;
  } catch (error) {
    const normalized =
      error instanceof ExecutionError
        ? error
        : new ExecutionError('PROVIDER_UNAVAILABLE', 'Tool execution failed.', true);

    await options.auditSink.write(
      createAuditEvent(options, executionId, 'FAILED', {
        errorCode: normalized.code,
      }),
    );
    throw normalized;
  }
}
