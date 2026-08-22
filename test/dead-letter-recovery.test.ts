import { describe, expect, it } from 'vitest';
import { InMemoryAuditSink } from '../src/core/audit.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import type {
  CoreCapabilityGateway,
  CoreCapabilityInspection,
} from '../src/orchestrator/contracts.js';
import { DeadLetterRecoveryService } from '../src/worker/dead-letter-recovery.js';
import type {
  DeadLetterRecoveryStore,
  DurableDeadLetterRecord,
} from '../src/worker/postgres-dead-letter.js';
import type { DeadLetterRecord } from '../src/worker/worker.js';

const NOW = '2026-08-22T18:00:00.000Z';
const identity = createTrustedServiceExecutionIdentity({
  principalId: 'acceptance:dlq-operator',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  organizationId: 'organization-a',
  roles: ['ADMIN'],
  allowedRouteIds: null,
  allowedCapabilityIds: null,
  allowedTargetAccounts: null,
  evidence: ['acceptance:dlq-recovery'],
  now: NOW,
});

function durable(overrides: Partial<DurableDeadLetterRecord> = {}): DurableDeadLetterRecord {
  return {
    id: 'dlq-1',
    originalJobId: 'job-1',
    toolName: 'whatsapp.message.send',
    payload: {
      idempotency_key: 'logical-send-1',
      approval_id: 'approval-1',
      tenant_id: 'tenant-a',
      workspace_id: 'workspace-a',
      organization_id: 'organization-a',
    },
    attempts: 3,
    lastError: 'Error: timeout',
    failedAt: NOW,
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    organizationId: 'organization-a',
    correlationId: 'corr-1',
    idempotencyKey: 'logical-send-1',
    evidence: ['dead-letter:source-job:job-1'],
    status: 'OPEN',
    replayCount: 0,
    replayExecutionId: null,
    replayStartedAt: null,
    lastReplayError: null,
    resolvedAt: null,
    resolution: null,
    ...overrides,
  };
}

class MemoryRecoveryStore implements DeadLetterRecoveryStore {
  record: DurableDeadLetterRecord;

  constructor(record = durable()) {
    this.record = record;
  }

  put(_record: DeadLetterRecord): Promise<void> {
    return Promise.resolve();
  }

  get(id: string): Promise<DurableDeadLetterRecord | undefined> {
    return Promise.resolve(id === this.record.id ? this.record : undefined);
  }

  claimReplay(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly replayExecutionId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<DurableDeadLetterRecord> {
    if (this.record.status === 'RESOLVED') return Promise.resolve(this.record);
    if (this.record.status === 'REPLAYING') {
      if (this.record.replayExecutionId !== input.replayExecutionId) {
        return Promise.reject(new Error('DEAD_LETTER_REPLAY_IN_PROGRESS'));
      }
      return Promise.resolve(this.record);
    }
    this.record = {
      ...this.record,
      status: 'REPLAYING',
      replayCount: this.record.replayCount + 1,
      replayExecutionId: input.replayExecutionId,
      replayStartedAt: input.now,
      evidence: [...this.record.evidence, ...input.evidence],
    };
    return Promise.resolve(this.record);
  }

  releaseReplay(input: {
    readonly replayExecutionId: string;
    readonly error: string;
    readonly evidence: readonly string[];
  }): Promise<DurableDeadLetterRecord> {
    if (this.record.replayExecutionId !== input.replayExecutionId) {
      return Promise.reject(new Error('DEAD_LETTER_REPLAY_RELEASE_CONFLICT'));
    }
    this.record = {
      ...this.record,
      status: 'OPEN',
      replayExecutionId: null,
      replayStartedAt: null,
      lastReplayError: input.error,
      evidence: [...this.record.evidence, ...input.evidence],
    };
    return Promise.resolve(this.record);
  }

  completeReplay(input: {
    readonly replayExecutionId: string;
    readonly resolution: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<DurableDeadLetterRecord> {
    if (this.record.status === 'RESOLVED') return Promise.resolve(this.record);
    if (this.record.replayExecutionId !== input.replayExecutionId) {
      return Promise.reject(new Error('DEAD_LETTER_REPLAY_RESOLUTION_CONFLICT'));
    }
    this.record = {
      ...this.record,
      status: 'RESOLVED',
      resolvedAt: input.now,
      resolution: input.resolution,
      evidence: [...this.record.evidence, ...input.evidence],
    };
    return Promise.resolve(this.record);
  }

  resolve(input: {
    readonly resolution: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<DurableDeadLetterRecord> {
    if (this.record.status === 'RESOLVED') return Promise.resolve(this.record);
    this.record = {
      ...this.record,
      status: 'RESOLVED',
      resolvedAt: input.now,
      resolution: input.resolution,
      evidence: [...this.record.evidence, ...input.evidence],
    };
    return Promise.resolve(this.record);
  }
}

class FakeCore implements CoreCapabilityGateway {
  executeCount = 0;
  readbackVerified = true;
  executeError: Error | null = null;
  inspection: CoreCapabilityInspection = {
    canonicalCapabilityId: 'whatsapp.message.send',
    routeId: 'R10',
    sideEffects: true,
    approvalRequired: true,
    idempotent: true,
  };

  inspect(): CoreCapabilityInspection {
    return this.inspection;
  }

  execute() {
    this.executeCount += 1;
    if (this.executeError) return Promise.reject(this.executeError);
    return Promise.resolve({
      executionId: `core-${this.executeCount}`,
      capabilityId: this.inspection.canonicalCapabilityId,
      result: { ok: true },
      providerReadbackVerified: this.readbackVerified,
    });
  }

  requestApproval(): Promise<never> {
    return Promise.reject(new Error('TEST_APPROVAL_NOT_EXPECTED'));
  }

  getApproval(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

function fixture(record = durable()) {
  const store = new MemoryRecoveryStore(record);
  const core = new FakeCore();
  const audit = new InMemoryAuditSink();
  const service = new DeadLetterRecoveryService({
    store,
    core,
    audit,
    now: () => new Date(NOW),
  });
  return { service, store, core, audit };
}

describe('DeadLetterRecoveryService', () => {
  it('replays an idempotent side effect through Core exactly once and resolves durably', async () => {
    const { service, store, core, audit } = fixture();
    const first = await service.replay({
      id: 'dlq-1',
      replayExecutionId: 'replay-1',
      identity,
      evidence: ['operator:approved-replay'],
    });
    expect(first.record.status).toBe('RESOLVED');
    expect(first.coreExecutionId).toBe('core-1');
    expect(core.executeCount).toBe(1);
    expect(audit.list().map((event) => event.status)).toEqual(['STARTED', 'SUCCEEDED']);

    const duplicate = await service.replay({
      id: 'dlq-1',
      replayExecutionId: 'replay-1',
      identity,
      evidence: ['operator:duplicate-request'],
    });
    expect(duplicate.alreadyResolved).toBe(true);
    expect(store.record.replayCount).toBe(1);
    expect(core.executeCount).toBe(1);
  });

  it('fails closed before claim when a side effect is not idempotent', async () => {
    const { service, store, core } = fixture();
    core.inspection = { ...core.inspection, idempotent: false };
    await expect(
      service.replay({
        id: 'dlq-1',
        replayExecutionId: 'replay-non-idempotent',
        identity,
        evidence: ['operator:test'],
      }),
    ).rejects.toThrow('DEAD_LETTER_REPLAY_NON_IDEMPOTENT_SIDE_EFFECT_FORBIDDEN');
    expect(store.record.status).toBe('OPEN');
    expect(core.executeCount).toBe(0);
  });

  it('fails closed when the stored and payload idempotency identities disagree', async () => {
    const { service, store, core } = fixture(durable({ idempotencyKey: 'different-key' }));
    await expect(
      service.replay({
        id: 'dlq-1',
        replayExecutionId: 'replay-mismatch',
        identity,
        evidence: ['operator:test'],
      }),
    ).rejects.toThrow('DEAD_LETTER_REPLAY_IDEMPOTENCY_MISMATCH');
    expect(store.record.status).toBe('OPEN');
    expect(core.executeCount).toBe(0);
  });

  it('releases the replay to OPEN and audits failure when provider readback is not verified', async () => {
    const { service, store, core, audit } = fixture();
    core.readbackVerified = false;
    await expect(
      service.replay({
        id: 'dlq-1',
        replayExecutionId: 'replay-unverified',
        identity,
        evidence: ['operator:test'],
      }),
    ).rejects.toThrow('DEAD_LETTER_REPLAY_PROVIDER_READBACK_UNVERIFIED');
    expect(store.record.status).toBe('OPEN');
    expect(store.record.lastReplayError).toBe('DEAD_LETTER_REPLAY_PROVIDER_READBACK_UNVERIFIED');
    expect(core.executeCount).toBe(1);
    expect(audit.list().map((event) => event.status)).toEqual(['STARTED', 'FAILED']);
  });

  it('rejects cross-tenant replay before Core execution', async () => {
    const otherIdentity = createTrustedServiceExecutionIdentity({
      principalId: 'acceptance:other-tenant',
      tenantId: 'tenant-b',
      workspaceId: 'workspace-b',
      organizationId: 'organization-b',
      roles: ['ADMIN'],
      evidence: ['acceptance:other-tenant'],
      now: NOW,
    });
    const { service, core } = fixture();
    await expect(
      service.replay({
        id: 'dlq-1',
        replayExecutionId: 'replay-cross-tenant',
        identity: otherIdentity,
        evidence: ['operator:test'],
      }),
    ).rejects.toThrow('DEAD_LETTER_TENANT_MISMATCH');
    expect(core.executeCount).toBe(0);
  });

  it('supports an explicit audited resolve without re-executing the failed capability', async () => {
    const { service, store, core, audit } = fixture();
    const resolved = await service.resolve({
      id: 'dlq-1',
      resolutionExecutionId: 'resolve-1',
      resolution: 'ROOT_CAUSE_FIXED_NO_REPLAY_REQUIRED',
      identity,
      evidence: ['operator:manual-resolution'],
    });
    expect(resolved.status).toBe('RESOLVED');
    expect(store.record.resolution).toBe('ROOT_CAUSE_FIXED_NO_REPLAY_REQUIRED');
    expect(core.executeCount).toBe(0);
    expect(audit.list().map((event) => event.status)).toEqual(['STARTED', 'SUCCEEDED']);
  });
});
