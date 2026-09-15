import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { BillingSnapshot } from '../src/finops/billing-snapshot.js';
import { PostgresBillingSnapshotStore } from '../src/finops/postgres-billing-snapshot-store.js';
import { PostgresFinopsReadModel } from '../src/finops/postgres-finops-read-model.js';
import type { CostEvent } from '../src/finops/cost-event.js';
import { PostgresCostLedger } from '../src/finops/postgres-cost-ledger.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('FINOPS_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('TOCA OS FinOps billing PostgreSQL E2E', () => {
  it('persists billing evidence and reconciles scoped ledger cost', async () => {
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 2 });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantId = `tenant-finops-billing-${suffix}`;
    const workspaceId = 'workspace-finops-billing';
    const organizationId = 'organization-finops-billing';
    const correlationId = `correlation-finops-billing-${suffix}`;
    const snapshotId = `billing-snapshot-${suffix}`;

    try {
      const ledgerMigration = await readFile(
        new URL('../migrations/041_finops_cost_ledger.sql', import.meta.url),
        'utf8',
      );
      const billingMigration = await readFile(
        new URL('../migrations/042_finops_billing_snapshots.sql', import.meta.url),
        'utf8',
      );
      await pool.query(ledgerMigration);
      await pool.query(billingMigration);

      const ledger = new PostgresCostLedger(pool);
      const billingStore = new PostgresBillingSnapshotStore(pool);
      const readModel = new PostgresFinopsReadModel(pool);

      const firstEvent: CostEvent = {
        eventId: `actual-a-${suffix}`,
        executionId: `execution-a-${suffix}`,
        correlationId,
        tenantId,
        workspaceId,
        organizationId,
        routeId: 'R-FINOPS-A',
        agentId: 'AG-FINOPS',
        provider: 'GOOGLE_VERTEX_AI',
        model: 'gemini-2.5-flash',
        category: 'AI_TEXT',
        phase: 'ACTUAL',
        priceCatalogVersion: 'google-vertex-ai-2026-09-15-v1',
        currency: 'USD',
        actualCostMicroUsd: 8_000,
        usage: { inputTokens: 10_000, outputTokens: 2_000 },
        campaignId: 'campaign-finops',
        createdAt: '2026-09-15T22:10:00Z',
      };
      const secondEvent: CostEvent = {
        ...firstEvent,
        eventId: `actual-b-${suffix}`,
        executionId: `execution-b-${suffix}`,
        routeId: 'R-FINOPS-B',
        actualCostMicroUsd: 2_000,
        usage: { inputTokens: 2_000, outputTokens: 400 },
        createdAt: '2026-09-15T22:20:00Z',
      };
      const otherTenantEvent: CostEvent = {
        ...firstEvent,
        eventId: `actual-other-${suffix}`,
        executionId: `execution-other-${suffix}`,
        tenantId: `${tenantId}-other`,
        actualCostMicroUsd: 999_999,
      };
      await ledger.append(firstEvent);
      await ledger.append(secondEvent);
      await ledger.append(otherTenantEvent);

      const snapshot: BillingSnapshot = {
        snapshotId,
        tenantId,
        workspaceId,
        organizationId,
        provider: 'GOOGLE_VERTEX_AI',
        model: 'gemini-2.5-flash',
        category: 'AI_TEXT',
        campaignId: 'campaign-finops',
        periodStart: '2026-09-15T22:00:00Z',
        periodEnd: '2026-09-15T23:00:00Z',
        currency: 'USD',
        billedCostMicroUsd: 10_500,
        evidenceRef: `billing:gcp:${suffix}`,
        observedAt: '2026-09-15T23:05:00Z',
      };

      expect(await billingStore.append(snapshot)).toMatchObject({ status: 'APPENDED' });
      const persisted = await billingStore.getById({
        tenantId,
        workspaceId,
        organizationId,
        snapshotId,
      });
      expect(persisted).toMatchObject({
        snapshotId,
        billedCostMicroUsd: 10_500,
        periodStart: '2026-09-15T22:00:00.000Z',
        periodEnd: '2026-09-15T23:00:00.000Z',
      });
      if (!persisted) throw new Error('FINOPS_BILLING_E2E_SNAPSHOT_MISSING');
      expect(await billingStore.append(persisted)).toMatchObject({ status: 'IDEMPOTENT_REPLAY' });
      await expect(
        billingStore.append({ ...persisted, billedCostMicroUsd: 10_501 }),
      ).rejects.toThrow('FINOPS_BILLING_SNAPSHOT_ID_CONFLICT');

      expect(
        await billingStore.getById({
          tenantId: `${tenantId}-other`,
          workspaceId,
          organizationId,
          snapshotId,
        }),
      ).toBeNull();

      const query = {
        tenantId,
        workspaceId,
        organizationId,
        periodStart: snapshot.periodStart,
        periodEnd: snapshot.periodEnd,
        provider: snapshot.provider,
        model: snapshot.model,
        category: snapshot.category,
        campaignId: snapshot.campaignId,
      } as const;
      expect(await readModel.aggregateActualCost(query)).toEqual({
        actualCostMicroUsd: 10_000,
        eventCount: 2,
      });
      expect(await readModel.aggregateActualCostByDimension(query, 'ROUTE')).toEqual([
        { groupKey: 'R-FINOPS-A', actualCostMicroUsd: 8_000, eventCount: 1 },
        { groupKey: 'R-FINOPS-B', actualCostMicroUsd: 2_000, eventCount: 1 },
      ]);
      expect(await readModel.reconcileBillingSnapshot(persisted, 500)).toMatchObject({
        snapshotId,
        status: 'WITHIN_TOLERANCE',
        ledgerActualCostMicroUsd: 10_000,
        billedCostMicroUsd: 10_500,
        deltaMicroUsd: 500,
        sideEffects: false,
      });
      expect(await readModel.reconcileBillingSnapshot(persisted)).toMatchObject({
        status: 'BILLING_EXCEEDS_LEDGER',
      });

      await expect(
        pool.query(
          'update finops_billing_snapshots set provider = provider where snapshot_id = $1',
          [snapshotId],
        ),
      ).rejects.toThrow('FINOPS_BILLING_SNAPSHOT_APPEND_ONLY');
      await expect(
        pool.query('delete from finops_billing_snapshots where snapshot_id = $1', [snapshotId]),
      ).rejects.toThrow('FINOPS_BILLING_SNAPSHOT_APPEND_ONLY');
      await expect(
        pool.query(
          `insert into finops_billing_snapshots (
             snapshot_id, snapshot_sha256, tenant_id, workspace_id, organization_id,
             provider, model, category, campaign_id, period_start, period_end,
             currency, billed_cost_micro_usd, evidence_ref, observed_at
           )
           select $2, snapshot_sha256, tenant_id, workspace_id, organization_id,
             provider, model, category, campaign_id, period_start, period_end,
             'BRL', billed_cost_micro_usd, evidence_ref, observed_at
           from finops_billing_snapshots where snapshot_id = $1`,
          [snapshotId, `${snapshotId}-brl`],
        ),
      ).rejects.toThrow();
    } finally {
      await pool.end();
    }
  });
});
