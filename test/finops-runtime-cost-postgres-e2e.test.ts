import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  Ag01RuntimeCostContext,
  Ag01VertexRuntimeCostObserver,
} from '../src/finops/ag01-runtime-cost-observer.js';
import { PostgresCostLedger } from '../src/finops/postgres-cost-ledger.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('FINOPS_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('TOCA OS FinOps runtime cost PostgreSQL E2E', () => {
  it('persists estimate, actual provider usage and reconciliation under one scoped correlation', async () => {
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 2 });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const correlationId = `finops-runtime-correlation-${suffix}`;
    const context = new Ag01RuntimeCostContext();

    try {
      const migrationSql = await readFile(
        new URL('../migrations/041_finops_cost_ledger.sql', import.meta.url),
        'utf8',
      );
      await pool.query(migrationSql);
      const ledger = new PostgresCostLedger(pool);
      const observer = new Ag01VertexRuntimeCostObserver(ledger, context);

      await context.run(
        {
          executionId: `finops-runtime-execution-${suffix}`,
          correlationId,
          tenantId: 'tenant-finops-runtime',
          workspaceId: 'workspace-finops-runtime',
          organizationId: 'organization-finops-runtime',
          startedAt: '2026-09-15T22:15:00.000Z',
        },
        async () => {
          await observer.beforeRequest({
            configuredModel: 'gemini-2.5-flash',
            estimatedInputTokens: 10_000,
            maxOutputTokens: 2_000,
          });
          await observer.afterResponse({
            configuredModel: 'gemini-2.5-flash',
            responseModel: 'gemini-2.5-flash-001',
            responseId: `vertex-response-${suffix}`,
            routeId: 'R17',
            agentId: 'AG-01',
            usage: { inputTokens: 8_000, cachedInputTokens: 1_000, outputTokens: 1_000 },
          });
        },
      );

      const events = await ledger.listByCorrelation({
        tenantId: 'tenant-finops-runtime',
        workspaceId: 'workspace-finops-runtime',
        organizationId: 'organization-finops-runtime',
        correlationId,
      });
      expect(events.map((event) => event.phase)).toEqual([
        'ESTIMATE',
        'ACTUAL',
        'RECONCILIATION',
      ]);
      expect(events[0]?.estimatedCostMicroUsd).toBe(8_000);
      expect(events[1]?.actualCostMicroUsd).toBe(4_630);
      expect(events[2]?.estimatedCostMicroUsd).toBe(8_000);
      expect(events[2]?.actualCostMicroUsd).toBe(4_630);
      expect(events[2]?.metadata?.reconciliationRef).toContain('WITHIN_ESTIMATE');
    } finally {
      await pool.end();
    }
  });
});
