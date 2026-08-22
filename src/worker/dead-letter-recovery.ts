import type { AuditSink } from '../core/audit.js';
import type { ExecutionIdentity } from '../core/identity.js';
import type { CoreCapabilityGateway } from '../orchestrator/contracts.js';
import type { DeadLetterRecoveryStore, DurableDeadLetterRecord } from './postgres-dead-letter.js';

export interface DeadLetterRecoveryDependencies {
  readonly store: DeadLetterRecoveryStore;
  readonly core: CoreCapabilityGateway;
  readonly audit: AuditSink;
  readonly now?: () => Date;
}

export interface DeadLetterReplayInput {
  readonly id: string;
  readonly replayExecutionId: string;
  readonly identity: ExecutionIdentity;
  readonly evidence: readonly string[];
}

export interface DeadLetterReplayResult {
  readonly record: DurableDeadLetterRecord;
  readonly coreExecutionId: string | null;
  readonly alreadyResolved: boolean;
}

export class DeadLetterRecoveryService {
  readonly #now: () => Date;

  constructor(private readonly deps: DeadLetterRecoveryDependencies) {
    this.#now = deps.now ?? (() => new Date());
  }

  async replay(input: DeadLetterReplayInput): Promise<DeadLetterReplayResult> {
    const evidence = normalizeEvidence(input.evidence);
    const replayExecutionId = requireText(
      input.replayExecutionId,
      'DEAD_LETTER_REPLAY_EXECUTION_ID_REQUIRED',
    );
    const existing = await this.requireScopedRecord(input.id, input.identity);
    if (existing.status === 'RESOLVED') {
      return { record: existing, coreExecutionId: null, alreadyResolved: true };
    }

    const inspection = this.deps.core.inspect({
      capabilityId: existing.toolName,
      payload: existing.payload,
      identity: input.identity,
    });
    assertReplaySafe(existing, inspection.sideEffects, inspection.idempotent);

    const claimed = await this.deps.store.claimReplay({
      id: existing.id,
      tenantId: existing.tenantId,
      replayExecutionId,
      evidence: [...evidence, `dead-letter:replay-claim:${replayExecutionId}`],
      now: this.#now().toISOString(),
    });
    if (claimed.status === 'RESOLVED') {
      return { record: claimed, coreExecutionId: null, alreadyResolved: true };
    }

    const auditBase = auditEventBase(claimed, input.identity, replayExecutionId);
    try {
      await this.deps.audit.write({
        ...auditBase,
        status: 'STARTED',
        evidence: [...evidence, `dead-letter:replay-started:${claimed.id}`],
        createdAt: this.#now().toISOString(),
      });

      const approvalId = payloadText(claimed.payload, 'approvalId', 'approval_id');
      const execution = await this.deps.core.execute({
        capabilityId: inspection.canonicalCapabilityId,
        payload: claimed.payload,
        correlationId: claimed.correlationId,
        identity: input.identity,
        ...(approvalId ? { approvalId } : {}),
      });
      if (inspection.sideEffects && !execution.providerReadbackVerified) {
        throw new Error('DEAD_LETTER_REPLAY_PROVIDER_READBACK_UNVERIFIED');
      }

      const resolved = await this.deps.store.completeReplay({
        id: claimed.id,
        tenantId: claimed.tenantId,
        replayExecutionId,
        resolution: `REPLAY_SUCCEEDED:${execution.executionId}`,
        evidence: [
          ...evidence,
          `dead-letter:core-execution:${execution.executionId}`,
          ...(execution.providerReadbackVerified ? ['dead-letter:provider-readback-verified'] : []),
        ],
        now: this.#now().toISOString(),
      });

      await this.deps.audit.write({
        ...auditBase,
        status: 'SUCCEEDED',
        evidence: [
          ...evidence,
          `dead-letter:replay-resolved:${claimed.id}`,
          `dead-letter:core-execution:${execution.executionId}`,
        ],
        createdAt: this.#now().toISOString(),
      });
      return {
        record: resolved,
        coreExecutionId: execution.executionId,
        alreadyResolved: false,
      };
    } catch (error) {
      const latest = await this.deps.store.get(claimed.id);
      if (latest?.status === 'REPLAYING' && latest.replayExecutionId === replayExecutionId) {
        await this.deps.store.releaseReplay({
          id: claimed.id,
          tenantId: claimed.tenantId,
          replayExecutionId,
          error: errorCode(error),
          evidence: [...evidence, `dead-letter:replay-failed:${errorCode(error)}`],
          now: this.#now().toISOString(),
        });
      }
      await this.deps.audit.write({
        ...auditBase,
        status: 'FAILED',
        errorCode: errorCode(error),
        evidence: [...evidence, `dead-letter:replay-failed:${claimed.id}`],
        createdAt: this.#now().toISOString(),
      });
      throw error;
    }
  }

  async resolve(input: {
    readonly id: string;
    readonly resolutionExecutionId: string;
    readonly resolution: string;
    readonly identity: ExecutionIdentity;
    readonly evidence: readonly string[];
  }): Promise<DurableDeadLetterRecord> {
    const evidence = normalizeEvidence(input.evidence);
    const executionId = requireText(
      input.resolutionExecutionId,
      'DEAD_LETTER_RESOLUTION_EXECUTION_ID_REQUIRED',
    );
    const existing = await this.requireScopedRecord(input.id, input.identity);
    if (existing.status === 'RESOLVED') return existing;

    this.deps.core.inspect({
      capabilityId: existing.toolName,
      payload: existing.payload,
      identity: input.identity,
    });
    const auditBase = auditEventBase(existing, input.identity, executionId);
    await this.deps.audit.write({
      ...auditBase,
      status: 'STARTED',
      evidence: [...evidence, `dead-letter:resolve-started:${existing.id}`],
      createdAt: this.#now().toISOString(),
    });
    const resolved = await this.deps.store.resolve({
      id: existing.id,
      tenantId: existing.tenantId,
      resolution: requireText(input.resolution, 'DEAD_LETTER_RESOLUTION_REQUIRED'),
      evidence: [...evidence, `dead-letter:resolved:${executionId}`],
      now: this.#now().toISOString(),
    });
    await this.deps.audit.write({
      ...auditBase,
      status: 'SUCCEEDED',
      evidence: [...evidence, `dead-letter:resolved:${existing.id}`],
      createdAt: this.#now().toISOString(),
    });
    return resolved;
  }

  private async requireScopedRecord(
    id: string,
    identity: ExecutionIdentity,
  ): Promise<DurableDeadLetterRecord> {
    const record = await this.deps.store.get(requireText(id, 'DEAD_LETTER_ID_REQUIRED'));
    if (!record) throw new Error('DEAD_LETTER_NOT_FOUND');
    const principal = identity.principal;
    if (record.tenantId !== principal.tenantId) throw new Error('DEAD_LETTER_TENANT_MISMATCH');
    if (record.workspaceId && record.workspaceId !== principal.workspaceId) {
      throw new Error('DEAD_LETTER_WORKSPACE_MISMATCH');
    }
    if (record.organizationId && record.organizationId !== principal.organizationId) {
      throw new Error('DEAD_LETTER_ORGANIZATION_MISMATCH');
    }
    return record;
  }
}

function assertReplaySafe(
  record: DurableDeadLetterRecord,
  sideEffects: boolean,
  idempotent: boolean,
): void {
  if (!sideEffects) return;
  if (!idempotent) throw new Error('DEAD_LETTER_REPLAY_NON_IDEMPOTENT_SIDE_EFFECT_FORBIDDEN');
  const payloadIdempotency = payloadText(record.payload, 'idempotencyKey', 'idempotency_key');
  if (!payloadIdempotency) throw new Error('DEAD_LETTER_REPLAY_IDEMPOTENCY_PAYLOAD_REQUIRED');
  if (payloadIdempotency !== record.idempotencyKey) {
    throw new Error('DEAD_LETTER_REPLAY_IDEMPOTENCY_MISMATCH');
  }
}

function auditEventBase(
  record: DurableDeadLetterRecord,
  identity: ExecutionIdentity,
  executionId: string,
) {
  return {
    executionId,
    correlationId: record.correlationId,
    toolName: record.toolName,
    requester: identity.principal.principalId,
    principalType: identity.principal.principalType,
    tenantId: identity.principal.tenantId,
    workspaceId: identity.principal.workspaceId,
    organizationId: identity.principal.organizationId,
    ...(identity.principal.sessionId ? { sessionId: identity.principal.sessionId } : {}),
    authenticationMethod: identity.principal.authenticationMethod,
    authorizationRoles: identity.authorization.roles,
  } as const;
}

function payloadText(payload: unknown, ...keys: readonly string[]): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const value = payload as Readonly<Record<string, unknown>>;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function normalizeEvidence(evidence: readonly string[]): readonly string[] {
  const normalized = [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error('DEAD_LETTER_EVIDENCE_REQUIRED');
  return normalized;
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 240);
  return String(error).slice(0, 240) || 'DEAD_LETTER_REPLAY_FAILED';
}
