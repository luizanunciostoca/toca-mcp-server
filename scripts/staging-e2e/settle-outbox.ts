import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PostgresTransactionalOutbox } from './src/events/postgres-transactional-outbox.js';
import { createPostgresPool } from './src/persistence/postgres.js';

const databaseUrl = process.env.DATABASE_URL;
const evidenceDir = process.env.EVIDENCE_DIR;
const runId = process.env.GITHUB_RUN_ID;
if (!databaseUrl) throw new Error('STAGING_E2E_DATABASE_URL_REQUIRED');
if (!evidenceDir) throw new Error('STAGING_E2E_EVIDENCE_DIR_REQUIRED');
if (!runId) throw new Error('STAGING_E2E_RUN_ID_REQUIRED');

function allowedSyntheticTenant(tenantId: string): boolean {
  return (
    tenantId === 'm12-tenant' ||
    tenantId === 'crm-sales-e2e-tenant' ||
    tenantId === 'whatsapp-e2e-tenant' ||
    tenantId.startsWith('attr-tenant-') ||
    tenantId.startsWith('ag01-tenant-') ||
    tenantId.startsWith('approval-a-') ||
    tenantId.startsWith('approval-b-') ||
    tenantId.startsWith('prepared-a-') ||
    tenantId.startsWith('prepared-b-') ||
    tenantId.startsWith(`staging-e2e-workflow-${runId}-`)
  );
}

const pool = createPostgresPool({ connectionString: databaseUrl, max: 3 });
const outbox = new PostgresTransactionalOutbox(pool);
try {
  const before = await pool.query<{
    tenant_id: string;
    status: string;
    count: string;
  }>(
    `select tenant_id, status, count(*)::text as count
       from event_outbox
      where status <> 'DELIVERED'
      group by tenant_id, status
      order by tenant_id, status`,
  );
  const unexpected = before.rows.filter((row) => !allowedSyntheticTenant(row.tenant_id));
  assert.deepEqual(unexpected, [], 'STAGING_E2E_UNEXPECTED_OUTBOX_ROW_FAIL_CLOSED');

  const recoveredEventIds: string[] = [];
  for (;;) {
    const recovered = await outbox.recoverStaleClaims({
      staleBefore: new Date(Date.now() + 60_000).toISOString(),
      now: new Date().toISOString(),
      nextAttemptAt: new Date().toISOString(),
      limit: 100,
      evidence: ['staging:e2e:synthetic-claim-recovered'],
    });
    recoveredEventIds.push(...recovered);
    if (recovered.length === 0) break;
  }

  const deliveredEventIds: string[] = [];
  for (;;) {
    const claimed = await outbox.claimAvailable({
      workerId: `staging-e2e-settler-${runId}`,
      now: new Date(Date.now() + 60_000).toISOString(),
      limit: 100,
    });
    if (claimed.length === 0) break;
    for (const entry of claimed) {
      assert(
        allowedSyntheticTenant(entry.record.tenantId),
        'STAGING_E2E_CLAIMED_UNEXPECTED_OUTBOX_ROW_FAIL_CLOSED',
      );
      await outbox.markDelivered({
        eventId: entry.record.eventId,
        executionId: entry.delivery.executionId,
        evidence: ['staging:e2e:synthetic-event-settled-without-provider'],
        now: new Date().toISOString(),
      });
      deliveredEventIds.push(entry.record.eventId);
    }
  }

  const after = await pool.query<{ count: string }>(
    `select count(*)::text as count from event_outbox where status <> 'DELIVERED'`,
  );
  const remainingNonterminal = Number(after.rows[0]?.count ?? '0');
  assert.equal(remainingNonterminal, 0, 'STAGING_E2E_OUTBOX_SETTLEMENT_INCOMPLETE');

  const summary = {
    schemaVersion: 'toca.staging.e2e.synthetic-outbox-settlement.v1',
    preSettlement: before.rows,
    recoveredClaimCount: recoveredEventIds.length,
    deliveredCount: deliveredEventIds.length,
    remainingNonterminal,
    providerDeliveryAttempted: false,
    providerMutation: 'NO',
    result: 'PASS',
  };
  await writeFile(
    join(evidenceDir, 'outbox-settlement.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary));
} finally {
  await pool.end();
}
