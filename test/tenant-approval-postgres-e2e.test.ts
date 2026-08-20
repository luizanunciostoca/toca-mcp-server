import { describe, expect, it } from 'vitest';
import type { ApprovalRecord } from '../src/governance/approval-governance.js';
import { bindApprovalStoreToScope } from '../src/governance/approval-scope.js';
import { PostgresApprovalStore } from '../src/persistence/postgres-approval-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function requestedRecord(
  approvalId: string,
  requester: string,
  correlationId: string,
): ApprovalRecord {
  return {
    approvalId,
    requester,
    approver: null,
    routeId: 'R28',
    capabilityId: 'meta_ads.campaign.create_paused',
    descriptorSha256: 'a'.repeat(64),
    targetAccount: 'act_test',
    scope: ['meta_ads.campaign.create_paused'],
    financialCeiling: null,
    requestedAt: '2026-08-20T19:00:00.000Z',
    issuedAt: null,
    expiresAt: '2026-08-21T19:00:00.000Z',
    consumedAt: null,
    revokedAt: null,
    reservationExecutionId: null,
    reservationPrincipalId: null,
    reservationCorrelationId: null,
    reservedAt: null,
    executingAt: null,
    providerReadbackAt: null,
    providerReadbackEvidence: [],
    releasedAt: null,
    releaseReason: null,
    failedReviewAt: null,
    failureReason: null,
    status: 'REQUESTED',
    evidence: ['postgres:e2e:tenant-approval'],
    correlationId,
    version: 1,
  };
}

postgresDescribe('tenant-scoped ApprovalRecord PostgreSQL E2E', () => {
  it('isolates get/list/history/transition and bound executor access across tenants', async () => {
    if (!DATABASE_URL) throw new Error('TENANT_APPROVAL_DATABASE_URL_REQUIRED');
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const scopeA = {
      tenantId: `approval-a-${suffix}`,
      workspaceId: `workspace-a-${suffix}`,
      organizationId: `organization-a-${suffix}`,
    };
    const scopeB = {
      tenantId: `approval-b-${suffix}`,
      workspaceId: `workspace-b-${suffix}`,
      organizationId: `organization-b-${suffix}`,
    };
    const approvalA = requestedRecord(`approval-a-${suffix}`, 'operator-a', `corr-a-${suffix}`);
    const approvalB = requestedRecord(`approval-b-${suffix}`, 'operator-b', `corr-b-${suffix}`);
    const pool = createPostgresPool({ connectionString: DATABASE_URL, max: 4 });
    try {
      for (const scope of [scopeA, scopeB]) {
        await pool.query(
          `insert into tenants (tenant_id, status, display_name, evidence)
           values ($1, 'ACTIVE', $2, '["postgres:e2e:tenant-approval"]'::jsonb)`,
          [scope.tenantId, scope.tenantId],
        );
      }
      const store = new PostgresApprovalStore(pool);
      await store.putScoped(approvalA, scopeA);
      await store.putScoped(approvalB, scopeB);

      expect((await store.listScoped(scopeA)).map((record) => record.approvalId)).toEqual([
        approvalA.approvalId,
      ]);
      expect((await store.listScoped(scopeB)).map((record) => record.approvalId)).toEqual([
        approvalB.approvalId,
      ]);
      expect(await store.getScoped(approvalA.approvalId, scopeB)).toBeUndefined();
      expect(await store.historyScoped(approvalA.approvalId, scopeB)).toEqual([]);
      await expect(
        store.transitionScoped(
          approvalA.approvalId,
          {
            type: 'RESERVE',
            expectation: {
              requester: approvalA.requester,
              routeId: approvalA.routeId,
              capabilityId: approvalA.capabilityId,
              descriptorSha256: approvalA.descriptorSha256,
              targetAccount: approvalA.targetAccount,
              requiredScope: approvalA.scope,
            },
            binding: {
              executionId: `exec-${suffix}`,
              principalId: approvalA.requester,
              correlationId: `exec-corr-${suffix}`,
            },
            now: '2026-08-20T19:05:00.000Z',
          },
          scopeB,
        ),
      ).rejects.toThrow('APPROVAL_NOT_FOUND');

      const boundA = bindApprovalStoreToScope(store, scopeA);
      const boundB = bindApprovalStoreToScope(store, scopeB);
      expect((await boundA.list()).map((record) => record.approvalId)).toEqual([
        approvalA.approvalId,
      ]);
      expect(await boundB.get(approvalA.approvalId)).toBeUndefined();
    } finally {
      await pool.end();
    }
  });
});
