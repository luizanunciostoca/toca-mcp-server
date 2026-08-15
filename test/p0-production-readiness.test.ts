import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../src/core/audit.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { RuntimeTelemetry } from '../src/core/observability.js';
import { evaluatePolicy } from '../src/core/policy.js';
import type { StructuredLogger } from '../src/core/structured-logger.js';
import { PostgresAuditSink } from '../src/persistence/postgres-audit-sink.js';
import { createToolRegistry } from '../src/registry.js';

const schedulerIdentity = createTrustedServiceExecutionIdentity({
  principalId: 'test-mcp-client',
  tenantId: 'toca-do-morcego',
  roles: ['OPERATOR'],
  allowedCapabilityIds: ['instagram.toca_schedule.create'],
  allowedTargetAccounts: [],
  evidence: ['test://p0-production-readiness'],
  now: '2026-08-14T00:59:00.000Z',
});

describe('P0 production scheduler policy', () => {
  it('requires a bounded identity for validated scheduler mutations', () => {
    const registry = createToolRegistry({ tocaManagedInstagramSchedulerEnabled: true });
    const tool = registry.get('instagram.toca_schedule.create');
    expect(tool).toMatchObject({
      capabilityStatus: 'PRODUCTION_VALIDATED',
      riskClass: 'WRITE_REVERSIBLE',
      sideEffects: true,
    });
    expect(tool && evaluatePolicy(tool, { requester: 'test-mcp-client' }).decision).toBe('DENY');
    expect(tool && evaluatePolicy(tool, { identity: schedulerIdentity }).decision).toBe('ALLOW');
  });

  it('persists identity-aware execution audit using the registered risk class', async () => {
    const registry = createToolRegistry({ tocaManagedInstagramSchedulerEnabled: true });
    const calls: unknown[][] = [];
    const pool = {
      query: (_sql: string, values: unknown[]) => {
        calls.push(values);
        return Promise.resolve({});
      },
    } as unknown as pg.Pool;
    const sink = new PostgresAuditSink(pool, registry);
    const event: AuditEvent = {
      executionId: 'exec-1',
      correlationId: 'corr-1',
      toolName: 'instagram.toca_schedule.create',
      requester: 'test-mcp-client',
      principalType: 'SERVICE',
      tenantId: 'toca-do-morcego',
      workspaceId: 'toca-do-morcego',
      organizationId: 'toca-do-morcego',
      authenticationMethod: 'INFRASTRUCTURE_IDENTITY',
      authorizationRoles: ['OPERATOR'],
      status: 'SUCCEEDED',
      createdAt: '2026-08-14T01:00:00.000Z',
    };

    await sink.write(event);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      'corr-1',
      'test-mcp-client',
      'instagram.toca_schedule.create',
      'WRITE_REVERSIBLE',
      'SUCCEEDED',
      JSON.stringify({
        executionId: 'exec-1',
        approvalId: null,
        connectedAccount: null,
        principalType: 'SERVICE',
        tenantId: 'toca-do-morcego',
        workspaceId: 'toca-do-morcego',
        organizationId: 'toca-do-morcego',
        sessionId: null,
        authenticationMethod: 'INFRASTRUCTURE_IDENTITY',
        authorizationRoles: ['OPERATOR'],
        createdAt: '2026-08-14T01:00:00.000Z',
      }),
      JSON.stringify({ externalResourceId: null, errorCode: null }),
    ]);
  });
});

describe('RuntimeTelemetry', () => {
  it('keeps counters and observations and renders Prometheus metrics', () => {
    const events: Array<{
      event: string;
      fields: Record<string, unknown> | undefined;
    }> = [];
    const logger: StructuredLogger = {
      info: (event, fields) => events.push({ event, fields }),
      error: (event, fields) => events.push({ event, fields }),
    };
    const telemetry = new RuntimeTelemetry(logger);

    telemetry.increment('worker.job.succeeded', { toolName: 'instagram.publish' });
    telemetry.increment('worker.job.succeeded', { toolName: 'instagram.publish' });
    telemetry.record('worker.job.duration_ms', 100, { outcome: 'success' });
    telemetry.record('worker.job.duration_ms', 300, { outcome: 'success' });

    const snapshot = telemetry.snapshot();
    expect(Object.values(snapshot.counters)).toEqual([2]);
    expect(Object.values(snapshot.observations)).toEqual([
      { count: 2, sum: 400, min: 100, max: 300, last: 300 },
    ]);
    const prometheus = telemetry.renderPrometheus();
    expect(prometheus).toContain('toca_worker_job_succeeded{toolName="instagram.publish"} 2');
    expect(prometheus).toContain('toca_worker_job_duration_ms_count{outcome="success"} 2');
    expect(events.length).toBeGreaterThanOrEqual(4);
  });
});
