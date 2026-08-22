import type { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../src/core/audit.js';
import type { AuditLedgerRecord, AuditLedgerVerification } from '../src/core/audit-ledger.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import {
  registerTocaCoreSurface,
  type CoreAuditQuerySink,
  type TocaCoreSurfaceDependencies,
} from '../src/mcp/core-surface.js';
import { createRuntimeCapabilityResolver } from '../src/mcp/runtime-capability-resolver.js';
import { createToolRegistry } from '../src/registry.js';
import { InMemoryScheduler } from '../src/scheduler/in-memory-scheduler.js';
import type { ScheduledJob } from '../src/scheduler/scheduler-contracts.js';
import {
  hashTocaManagedInstagramApprovalDescriptor,
  TocaManagedInstagramScheduler,
  type TocaManagedInstagramApprovalDescriptor,
} from '../src/scheduler/toca-managed-instagram-scheduler.js';

const NOW = '2026-08-15T20:00:00.000Z';
const TENANT = 'toca-do-morcego';

type ToolHandler = (input: Record<string, unknown>, context: Record<string, unknown>) => unknown;

class TenantAwareInMemoryScheduler extends InMemoryScheduler {
  override async schedule<TPayload>(
    job: Omit<ScheduledJob<TPayload>, 'status' | 'attempts'>,
  ): Promise<ScheduledJob<TPayload>> {
    return { ...(await super.schedule(job)), tenantId: TENANT };
  }
}

class MFound12AuditStore implements CoreAuditQuerySink {
  private readonly events: AuditEvent[] = [];

  write(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  listByCorrelation(correlationId: string, limit = 100): Promise<readonly AuditLedgerRecord[]> {
    const selected = this.events
      .filter((event) => event.correlationId === correlationId)
      .slice(-limit);
    return Promise.resolve(
      selected.map((event, index): AuditLedgerRecord => ({
        ...event,
        eventId: `m12-audit-${correlationId}-${index + 1}`,
        riskClass: event.toolName.includes('toca_schedule.create') ? 'WRITE_REVERSIBLE' : 'READ',
        sequence: index + 1,
        previousHash: '0'.repeat(64),
        eventHash: '1'.repeat(64),
        evidence: event.evidence ?? [],
        canonicalPayload: {},
      })),
    );
  }

  verifyExecution(executionId: string): Promise<AuditLedgerVerification> {
    const selected = this.events.filter((event) => event.executionId === executionId);
    const valid = selected.length > 0 && selected.at(-1)?.status === 'SUCCEEDED';
    return Promise.resolve({
      valid,
      executionId,
      recordCount: selected.length,
      lastSequence: selected.length,
      headHash: valid ? '1'.repeat(64) : '0'.repeat(64),
      reason: valid ? null : 'M_FOUND_12_EXECUTION_NOT_SUCCEEDED',
    });
  }

  list(): readonly AuditEvent[] {
    return this.events;
  }
}

function captureSurface(dependencies: TocaCoreSurfaceDependencies): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: unknown) {
      handlers.set(name, handler as ToolHandler);
    },
  } as unknown as McpServer;
  registerTocaCoreSurface(server, dependencies);
  return handlers;
}

function structured<T>(value: unknown): T {
  return (value as { structuredContent: T }).structuredContent;
}

function schedulePayload(correlationId: string) {
  const descriptor: TocaManagedInstagramApprovalDescriptor = {
    schemaVersion: 1,
    contentItemId: 'M12-E2E-CORE-FACADE',
    scheduledFor: '2099-01-01T12:00:00-03:00',
    timezone: 'America/Bahia',
    account: {
      pageId: 'M12_PAGE_NO_PROVIDER_WRITE',
      instagramAccountId: 'M12_IG_NO_PROVIDER_WRITE',
    },
    mediaType: 'IMAGE',
    asset: {
      assetId: 'M12-ASSET',
      objectName: 'm12/e2e.jpg',
      sha256: '0'.repeat(64),
      contentType: 'image/jpeg',
    },
    caption: 'M-FOUND-12 deterministic Core facade proof',
    correlationId,
    publicationIdempotencyKey: 'm12-publication-idempotency',
  };
  return {
    ...descriptor,
    approval: {
      mode: 'EXPLICIT_APPROVAL' as const,
      status: 'APPROVED' as const,
      approvedDescriptorSha256: hashTocaManagedInstagramApprovalDescriptor(descriptor),
    },
  };
}

describe('M-FOUND-12 governed Core facade E2E', () => {
  it('executes WRITE_REVERSIBLE through discovery/runtime/policy/idempotency/readback/audit/verify', async () => {
    let sequence = 0;
    const scheduler = new TocaManagedInstagramScheduler(
      new TenantAwareInMemoryScheduler(),
      () => `m12-job-${++sequence}`,
    );
    const registry = createToolRegistry({ tocaManagedInstagramSchedulerEnabled: true });
    const runtimeResolver = createRuntimeCapabilityResolver({
      instagramScheduler: () => scheduler,
    });
    const auditStore = new MFound12AuditStore();
    const identity = createTrustedServiceExecutionIdentity({
      principalId: 'm12:operator',
      tenantId: TENANT,
      roles: ['OPERATOR'],
      allowedCapabilityIds: ['instagram.toca_schedule.create', 'instagram.toca_schedule.status'],
      evidence: ['m12:trusted-test-identity'],
      now: NOW,
    });
    const handlers = captureSurface({
      serviceName: 'toca-mcp-server',
      serviceVersion: 'm-found-12',
      registry,
      runtimeResolver,
      resolveIdentity: () => identity,
      auditStore,
    });
    const execute = handlers.get('toca.execute');
    const verify = handlers.get('toca.verify');
    expect(execute).toBeDefined();
    expect(verify).toBeDefined();

    const payload = schedulePayload('m12:e2e:write-reversible');
    const first = structured<{
      executionId: string;
      correlationId: string;
      capabilityId: string;
      result: { id: string; status: string };
      providerReadbackVerified: boolean;
    }>(
      await execute!(
        {
          capabilityId: 'instagram.toca_schedule.create',
          payload,
          correlationId: 'm12:e2e:write-reversible',
        },
        {},
      ),
    );

    expect(first.capabilityId).toBe('instagram.toca_schedule.create');
    expect(first.providerReadbackVerified).toBe(true);
    expect(first.result).toMatchObject({ id: 'm12-job-1', status: 'SCHEDULED' });
    expect(await scheduler.list()).toHaveLength(1);

    const verified = structured<{
      verified: boolean;
      descriptorBound: boolean;
      provider: {
        required: boolean;
        verified: boolean;
        auditedResourceId?: string;
        readbackResourceId?: string;
      };
    }>(
      await verify!(
        {
          executionId: first.executionId,
          correlationId: first.correlationId,
          capabilityId: first.capabilityId,
          payload,
          result: first.result,
        },
        {},
      ),
    );

    expect(verified).toMatchObject({
      verified: true,
      descriptorBound: true,
      provider: {
        required: true,
        verified: true,
        auditedResourceId: 'm12-job-1',
        readbackResourceId: 'm12-job-1',
      },
    });
    const lastAudit = auditStore.list().at(-1);
    expect(lastAudit).toMatchObject({
      status: 'SUCCEEDED',
      externalResourceId: 'm12-job-1',
    });
    expect(lastAudit?.evidence).toEqual(
      expect.arrayContaining([
        'provider:readback:instagram.toca_schedule.create',
        'scheduler:job:m12-job-1:scheduled',
      ]),
    );
  });

  it('replays the same scheduled write without creating a duplicate durable job', async () => {
    let sequence = 0;
    const scheduler = new TocaManagedInstagramScheduler(
      new TenantAwareInMemoryScheduler(),
      () => `m12-replay-job-${++sequence}`,
    );
    const registry = createToolRegistry({ tocaManagedInstagramSchedulerEnabled: true });
    const runtimeResolver = createRuntimeCapabilityResolver({
      instagramScheduler: () => scheduler,
    });
    const auditStore = new MFound12AuditStore();
    const identity = createTrustedServiceExecutionIdentity({
      principalId: 'm12:operator',
      tenantId: TENANT,
      roles: ['OPERATOR'],
      allowedCapabilityIds: ['instagram.toca_schedule.create'],
      evidence: ['m12:trusted-test-identity'],
      now: NOW,
    });
    const execute = captureSurface({
      serviceName: 'toca-mcp-server',
      serviceVersion: 'm-found-12',
      registry,
      runtimeResolver,
      resolveIdentity: () => identity,
      auditStore,
    }).get('toca.execute')!;
    const payload = schedulePayload('m12:e2e:replay');

    const first = structured<{ result: { id: string } }>(
      await execute(
        {
          capabilityId: 'instagram.toca_schedule.create',
          payload,
          correlationId: 'm12:e2e:replay:first',
        },
        {},
      ),
    );
    const second = structured<{ result: { id: string } }>(
      await execute(
        {
          capabilityId: 'instagram.toca_schedule.create',
          payload,
          correlationId: 'm12:e2e:replay:second',
        },
        {},
      ),
    );

    expect(first.result.id).toBe('m12-replay-job-1');
    expect(second.result.id).toBe(first.result.id);
    expect(await scheduler.list()).toHaveLength(1);
    expect(sequence).toBe(2);
  });

  it('executes a READ through the same Core resolver without provider-write side effects', async () => {
    const scheduler = new TocaManagedInstagramScheduler(
      new TenantAwareInMemoryScheduler(),
      () => 'm12-read-job',
    );
    const payload = schedulePayload('m12:e2e:read-bootstrap');
    await scheduler.schedule(payload);

    const registry = createToolRegistry({ tocaManagedInstagramSchedulerEnabled: true });
    const runtimeResolver = createRuntimeCapabilityResolver({
      instagramScheduler: () => scheduler,
    });
    const auditStore = new MFound12AuditStore();
    const identity = createTrustedServiceExecutionIdentity({
      principalId: 'm12:reader',
      tenantId: TENANT,
      roles: ['READER'],
      allowedCapabilityIds: ['instagram.toca_schedule.status'],
      evidence: ['m12:trusted-test-identity'],
      now: NOW,
    });
    const execute = captureSurface({
      serviceName: 'toca-mcp-server',
      serviceVersion: 'm-found-12',
      registry,
      runtimeResolver,
      resolveIdentity: () => identity,
      auditStore,
    }).get('toca.execute')!;

    const result = structured<{
      capabilityId: string;
      result: { job: { id: string; status: string } };
      providerReadbackVerified: boolean;
    }>(
      await execute(
        {
          capabilityId: 'instagram.toca_schedule.status',
          payload: { jobId: 'm12-read-job' },
          correlationId: 'm12:e2e:read',
        },
        {},
      ),
    );

    expect(result).toMatchObject({
      capabilityId: 'instagram.toca_schedule.status',
      result: { job: { id: 'm12-read-job', status: 'SCHEDULED' } },
      providerReadbackVerified: true,
    });
    expect(await scheduler.list()).toHaveLength(1);
  });
});
