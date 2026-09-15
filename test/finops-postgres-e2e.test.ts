import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { CostEvent } from '../src/finops/cost-event.js';
import { PostgresCostLedger } from '../src/finops/postgres-cost-ledger.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('FINOPS_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('TOCA OS FinOps PostgreSQL E2E', () => {
  it('applies migration and enforces scoped append-only idempotent persistence', async () => {
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 2 });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const eventId = `finops-e2e-${suffix}`;
    const correlationId = `finops-correlation-${suffix}`;

    try {
      const migrationSql = await readFile(
        new URL('../migrations/041_finops_cost_ledger.sql', import.meta.url),
        'utf8',
      );
      await pool.query(migrationSql);

      const ledger = new PostgresCostLedger(pool);
      const event: CostEvent = {
        eventId,
        executionId: `finops-execution-${suffix}`,
        correlationId,
        tenantId: 'tenant-finops-a',
        workspaceId: 'workspace-finops',
        organizationId: 'organization-finops',
        routeId: 'R-FINOPS-E2E',
        agentId: 'AG-FINOPS-E2E',
        provider: 'GOOGLE_VERTEX_AI',
        model: 'gemini-2.5-flash',
        category: 'AI_TEXT',
        phase: 'ESTIMATE',
        priceCatalogVersion: '2026-09-15.v1',
        currency: 'USD',
        estimatedCostMicroUsd: 8_000,
        usage: { inputTokens: 10_000, cachedInputTokens: 0, outputTokens: 2_000 },
        createdAt: '2026-09-15T21:00:00Z',
      };

      expect(await ledger.append(event)).toMatchObject({ status: 'APPENDED' });
      expect(
        await ledger.append({
          ...event,
          eventId: `${eventId}-other-tenant`,
          tenantId: 'tenant-finops-b',
        }),
      ).toMatchObject({ status: 'APPENDED' });

      const rows = await ledger.listByCorrelation({
        tenantId: 'tenant-finops-a',
        workspaceId: 'workspace-finops',
        organizationId: 'organization-finops',
        correlationId,
      });
      expect(rows).toHaveLength(1);
      const roundTripped = rows[0];
      if (!roundTripped) throw new Error('FINOPS_E2E_ROUND_TRIP_MISSING');
      expect(roundTripped).toMatchObject({
        eventId,
        tenantId: 'tenant-finops-a',
        metadata: {},
        createdAt: '2026-09-15T21:00:00.000Z',
      });

      const otherTenantRows = await ledger.listByCorrelation({
        tenantId: 'tenant-finops-b',
        workspaceId: 'workspace-finops',
        organizationId: 'organization-finops',
        correlationId,
      });
      expect(otherTenantRows.map((row) => row.eventId)).toEqual([`${eventId}-other-tenant`]);

      expect(await ledger.append(roundTripped)).toMatchObject({ status: 'IDEMPOTENT_REPLAY' });
      await expect(
        ledger.append({
          ...roundTripped,
          usage: { ...roundTripped.usage, outputTokens: 2_001 },
        }),
      ).rejects.toThrow('FINOPS_COST_EVENT_ID_CONFLICT');

      await expect(
        pool.query('update finops_cost_events set provider = provider where event_id = $1', [
          eventId,
        ]),
      ).rejects.toThrow('FINOPS_COST_LEDGER_APPEND_ONLY');
      await expect(
        pool.query('delete from finops_cost_events where event_id = $1', [eventId]),
      ).rejects.toThrow('FINOPS_COST_LEDGER_APPEND_ONLY');

      await expect(
        pool.query(
          `insert into finops_cost_events (
             event_id, event_sha256, execution_id, correlation_id,
             tenant_id, workspace_id, organization_id, route_id, agent_id,
             provider, model, category, phase, price_catalog_version, currency,
             estimated_cost_micro_usd, actual_cost_micro_usd, usage,
             content_item_id, campaign_id, metadata, created_at
           )
           select $2, event_sha256, execution_id, correlation_id,
             ' ', workspace_id, organization_id, route_id, agent_id,
             provider, model, category, phase, price_catalog_version, currency,
             estimated_cost_micro_usd, actual_cost_micro_usd, usage,
             content_item_id, campaign_id, metadata, created_at
           from finops_cost_events where event_id = $1`,
          [eventId, `${eventId}-blank-scope`],
        ),
      ).rejects.toThrow();

      await expect(
        pool.query(
          `insert into finops_cost_events (
             event_id, event_sha256, execution_id, correlation_id,
             tenant_id, workspace_id, organization_id, route_id, agent_id,
             provider, model, category, phase, price_catalog_version, currency,
             estimated_cost_micro_usd, actual_cost_micro_usd, usage,
             content_item_id, campaign_id, metadata, created_at
           )
           select $2, event_sha256, execution_id, correlation_id,
             tenant_id, workspace_id, organization_id, route_id, agent_id,
             provider, model, category, phase, price_catalog_version, currency,
             estimated_cost_micro_usd, actual_cost_micro_usd, usage,
             content_item_id, campaign_id, '[]'::jsonb, created_at
           from finops_cost_events where event_id = $1`,
          [eventId, `${eventId}-invalid-json`],
        ),
      ).rejects.toThrow();
    } finally {
      await pool.end();
    }
  });
});
