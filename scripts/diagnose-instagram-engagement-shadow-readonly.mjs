import { createHash } from 'node:crypto';
import pg from 'pg';

const databaseUrl = required('DATABASE_URL');
const targetRun = required('TARGET_FAILED_RUN');
const startedAt = requiredDate('TRACE_STARTED_AT');
const endedAt = requiredDate('TRACE_ENDED_AT');

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query('begin transaction read only');

  const meta = await client.query(
    `select event_id, occurred_at, received_at
       from meta_webhook_events
      where channel = 'COMMENT'
        and sender_scoped_id like 'shadow-proof-comment-sender-%'
        and received_at >= $1::timestamptz - interval '2 minutes'
        and received_at <= $2::timestamptz + interval '2 minutes'
      order by received_at desc
      limit 1`,
    [startedAt, endedAt],
  );

  const metaRow = meta.rows[0] ?? null;
  let outboxRow = null;
  let attempts = [];
  let actionRow = null;

  if (metaRow) {
    const outbox = await client.query(
      `select event_id, status, attempts, max_attempts, available_at, claimed_at,
              delivered_at, last_error_code, tenant_id, workspace_id, organization_id
         from event_outbox
        where event_type = 'instagram.engagement.inbound.v1'
          and payload->>'eventId' = $1
        order by occurred_at desc
        limit 1`,
      [metaRow.event_id],
    );
    outboxRow = outbox.rows[0] ?? null;

    if (outboxRow) {
      const attemptResult = await client.query(
        `select attempt_number, status, error_code, claimed_at, completed_at, evidence
           from event_outbox_delivery_attempts
          where event_id = $1
          order by attempt_number asc`,
        [outboxRow.event_id],
      );
      attempts = attemptResult.rows;
    }

    const action = await client.query(
      `select status, intent, risk, autonomy, faq_id, failure_code,
              (provider_reply_id is not null) as external_reply_observed,
              created_at, updated_at
         from instagram_engagement_actions
        where event_id = $1`,
      [metaRow.event_id],
    );
    actionRow = action.rows[0] ?? null;
  }

  const backlog = await client.query(
    `select status, count(*)::int as count
       from event_outbox
      where event_type in ('instagram.engagement.inbound.v1','instagram.engagement.reply.v1')
      group by status
      order by status`,
  );

  const dueBacklog = await client.query(
    `select count(*)::int as count
       from event_outbox
      where event_type = 'instagram.engagement.inbound.v1'
        and status in ('PENDING','FAILED_RETRYABLE')
        and available_at <= now()`,
  );

  await client.query('rollback');

  const diagnosis = classify({ metaRow, outboxRow, actionRow, endedAt });
  const output = {
    schemaVersion: 'toca.instagram-engagement.shadow-readonly-trace.v1',
    targetFailedRun: targetRun,
    traceWindow: { startedAt, endedAt },
    diagnosis,
    metaWebhook: metaRow
      ? {
          found: true,
          eventFingerprint: fingerprint(metaRow.event_id),
          occurredAt: iso(metaRow.occurred_at),
          receivedAt: iso(metaRow.received_at),
        }
      : { found: false },
    inboundOutbox: outboxRow
      ? {
          found: true,
          eventFingerprint: fingerprint(outboxRow.event_id),
          status: outboxRow.status,
          attempts: Number(outboxRow.attempts),
          maxAttempts: Number(outboxRow.max_attempts),
          availableAt: iso(outboxRow.available_at),
          claimedAt: nullableIso(outboxRow.claimed_at),
          deliveredAt: nullableIso(outboxRow.delivered_at),
          lastErrorCode: outboxRow.last_error_code ?? null,
          scopeMatches:
            outboxRow.tenant_id === 'toca' &&
            outboxRow.workspace_id === 'toca' &&
            outboxRow.organization_id === 'toca',
        }
      : { found: false },
    deliveryAttempts: attempts.map((row) => ({
      attemptNumber: Number(row.attempt_number),
      status: row.status,
      errorCode: row.error_code ?? null,
      claimedAt: iso(row.claimed_at),
      completedAt: nullableIso(row.completed_at),
      evidence: safeEvidence(row.evidence),
    })),
    action: actionRow
      ? {
          found: true,
          status: actionRow.status,
          intent: actionRow.intent,
          risk: actionRow.risk,
          autonomy: actionRow.autonomy,
          faqId: actionRow.faq_id ?? null,
          failureCode: actionRow.failure_code ?? null,
          externalReplyObserved: actionRow.external_reply_observed === true,
          createdAt: iso(actionRow.created_at),
          updatedAt: iso(actionRow.updated_at),
          createdAfterFailedRunClosed: Date.parse(actionRow.created_at) > Date.parse(endedAt),
        }
      : { found: false },
    currentEngagementOutboxByStatus: Object.fromEntries(
      backlog.rows.map((row) => [row.status, Number(row.count)]),
    ),
    currentDueInboundBacklog: Number(dueBacklog.rows[0]?.count ?? 0),
    databaseMutationPerformed: false,
    externalReplyWritesAuthorized: false,
    rawSenderPrinted: false,
    rawMessagePrinted: false,
    secretsPrinted: false,
  };

  process.stdout.write(`${JSON.stringify(output)}\n`);
} catch (error) {
  try {
    await client.query('rollback');
  } catch {}
  throw error;
} finally {
  await client.end();
}

function classify({ metaRow, outboxRow, actionRow, endedAt }) {
  if (!metaRow) return 'META_SYNTHETIC_COMMENT_NOT_FOUND';
  if (!outboxRow) return 'INBOUND_OUTBOX_NOT_ENQUEUED';
  if (actionRow) {
    return Date.parse(actionRow.created_at) > Date.parse(endedAt)
      ? 'LATE_ACTION_OBSERVED_AFTER_PROOF_WINDOW'
      : 'ACTION_EXISTS_WITHIN_RUN_WINDOW';
  }
  if (outboxRow.status === 'PENDING') return 'INBOUND_PENDING_NOT_CLAIMED';
  if (outboxRow.status === 'FAILED_RETRYABLE') return 'PROCESSOR_FAILED_RETRYABLE';
  if (outboxRow.status === 'DEAD_LETTER') return 'PROCESSOR_DEAD_LETTER';
  if (outboxRow.status === 'CLAIMED') return 'INBOUND_CLAIM_STUCK';
  if (outboxRow.status === 'DELIVERED') return 'ACTION_MISSING_AFTER_DELIVERY_INVARIANT_BREACH';
  return 'INBOUND_STATE_UNKNOWN';
}

function safeEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .filter((item) => /^[A-Za-z0-9:._-]{1,160}$/.test(item))
    .slice(0, 20);
}

function fingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function iso(value) {
  return new Date(value).toISOString();
}

function nullableIso(value) {
  return value == null ? null : iso(value);
}

function required(key) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
}

function requiredDate(key) {
  const value = required(key);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${key}_INVALID`);
  return new Date(value).toISOString();
}
