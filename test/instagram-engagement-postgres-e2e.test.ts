import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PostgresTransactionalOutbox } from '../src/events/postgres-transactional-outbox.js';
import { INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE } from '../src/instagram-engagement/events.js';
import {
  claimInstagramEngagementEvents,
  recoverStaleInstagramEngagementClaims,
} from '../src/instagram-engagement/typed-outbox.js';
import { PostgresMetaWebhookEventStore } from '../src/persistence/meta-webhook-event-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('INSTAGRAM_ENGAGEMENT_E2E_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('Instagram engagement PostgreSQL E2E', () => {
  it('deduplicates webhook enqueue, claims once and recovers only Instagram stale leases', async () => {
    const pool = createPostgresPool({ connectionString: databaseUrl() });
    const suffix = randomUUID();
    const webhookEventId = `instagram-e2e-${suffix}`;
    const inboundOutboxId = `instagram-engagement-inbound:${webhookEventId}`;
    const genericEventId = `generic-e2e-${suffix}`;
    const genericExecutionId = `generic-execution-${suffix}`;
    const scope = {
      tenantId: `tenant-${suffix}`,
      workspaceId: `workspace-${suffix}`,
      organizationId: `organization-${suffix}`,
    };
    const firstClaimAt = '2026-08-28T23:00:00.000Z';
    const recoveredAt = '2026-08-28T23:10:00.000Z';
    const outbox = new PostgresTransactionalOutbox(pool);
    const store = new PostgresMetaWebhookEventStore(pool, {
      outbox,
      engagementScope: scope,
    });

    try {
      const schema = await pool.query<{ table_name: string | null }>(
        `select to_regclass('public.instagram_engagement_actions')::text as table_name`,
      );
      expect(schema.rows[0]?.table_name).toBe('instagram_engagement_actions');

      const event = {
        eventId: webhookEventId,
        accountId: 'instagram-business-e2e',
        channel: 'DIRECT' as const,
        senderId: `sender-${suffix}`,
        messageId: `message-${suffix}`,
        text: 'Qual o horário?',
        occurredAt: '2026-08-28T22:59:00.000Z',
        rawType: 'messaging',
      };

      const first = await store.persist([event]);
      expect(first.accepted).toHaveLength(1);
      expect(first.duplicates).toHaveLength(0);

      const duplicate = await store.persist([event]);
      expect(duplicate.accepted).toHaveLength(0);
      expect(duplicate.duplicates).toHaveLength(1);

      const durable = await pool.query<{ count: string }>(
        `select count(*)::text as count from event_outbox where event_id = $1`,
        [inboundOutboxId],
      );
      expect(durable.rows[0]?.count).toBe('1');

      const firstClaim = await claimInstagramEngagementEvents({
        pool,
        workerId: 'instagram-engagement-e2e-worker',
        eventTypes: [INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE],
        now: firstClaimAt,
        limit: 10,
      });
      expect(firstClaim).toHaveLength(1);
      expect(firstClaim[0]?.eventId).toBe(inboundOutboxId);
      expect(firstClaim[0]?.attemptNumber).toBe(1);

      const duplicateClaim = await claimInstagramEngagementEvents({
        pool,
        workerId: 'instagram-engagement-e2e-worker-2',
        eventTypes: [INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE],
        now: firstClaimAt,
        limit: 10,
      });
      expect(duplicateClaim).toHaveLength(0);

      await pool.query(
        `insert into event_outbox (
           event_id, event_key, event_type, schema_version, aggregate_type, aggregate_id,
           aggregate_version, tenant_id, workspace_id, organization_id, correlation_id,
           causation_id, occurred_at, payload, evidence, status, available_at, attempts,
           max_attempts, claimed_by, claim_execution_id, claimed_at, delivered_at,
           last_error_code, version
         ) values (
           $1, $1, 'other.domain.event.v1', '1', 'other_domain', $1,
           1, $2, $3, $4, $1,
           null, $5::timestamptz, '{}'::jsonb, '["test:generic-stale"]'::jsonb,
           'CLAIMED', $5::timestamptz, 1, 5, 'other-worker', $6,
           $5::timestamptz, null, null, 1
         )`,
        [
          genericEventId,
          scope.tenantId,
          scope.workspaceId,
          scope.organizationId,
          firstClaimAt,
          genericExecutionId,
        ],
      );
      await pool.query(
        `insert into event_outbox_delivery_attempts (
           execution_id, event_id, worker_id, attempt_number, status, claimed_at, evidence
         ) values ($1, $2, 'other-worker', 1, 'CLAIMED', $3::timestamptz, '[]'::jsonb)`,
        [genericExecutionId, genericEventId, firstClaimAt],
      );

      const recovered = await recoverStaleInstagramEngagementClaims({
        pool,
        eventTypes: [INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE],
        staleBefore: '2026-08-28T23:05:00.000Z',
        now: recoveredAt,
        limit: 10,
      });
      expect(recovered).toEqual([inboundOutboxId]);

      const genericState = await pool.query<{ status: string }>(
        `select status from event_outbox where event_id = $1`,
        [genericEventId],
      );
      expect(genericState.rows[0]?.status).toBe('CLAIMED');

      const retryClaim = await claimInstagramEngagementEvents({
        pool,
        workerId: 'instagram-engagement-e2e-worker-retry',
        eventTypes: [INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE],
        now: recoveredAt,
        limit: 10,
      });
      expect(retryClaim).toHaveLength(1);
      expect(retryClaim[0]?.attemptNumber).toBe(2);

      const retry = retryClaim[0];
      if (!retry) throw new Error('INSTAGRAM_ENGAGEMENT_E2E_RETRY_MISSING');
      await outbox.markDelivered({
        eventId: retry.eventId,
        executionId: retry.executionId,
        evidence: ['test:instagram-engagement:delivered'],
        now: '2026-08-28T23:11:00.000Z',
      });

      const delivered = await pool.query<{ status: string; attempts: number }>(
        `select status, attempts from event_outbox where event_id = $1`,
        [inboundOutboxId],
      );
      expect(delivered.rows[0]).toEqual({ status: 'DELIVERED', attempts: 2 });
    } finally {
      await pool.query(`delete from event_outbox_delivery_attempts where event_id in ($1, $2)`, [
        inboundOutboxId,
        genericEventId,
      ]);
      await pool.query(`delete from event_consumer_receipts where event_id in ($1, $2)`, [
        inboundOutboxId,
        genericEventId,
      ]);
      await pool.query(`delete from event_outbox where event_id in ($1, $2)`, [
        inboundOutboxId,
        genericEventId,
      ]);
      await pool.query(`delete from instagram_engagement_actions where event_id = $1`, [
        webhookEventId,
      ]);
      await pool.query(`delete from meta_webhook_events where event_id = $1`, [webhookEventId]);
      await pool.query(`delete from audit_events where correlation_id = $1`, [webhookEventId]);
      await pool.end();
    }
  });
});
