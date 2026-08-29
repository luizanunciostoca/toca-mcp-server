import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseMetaWebhookEvents } from '../providers/meta/meta-webhook.js';

const databaseUrl = requiredEnv('DATABASE_URL');
const webhookUrl = requiredEnv('INSTAGRAM_ENGAGEMENT_SHADOW_WEBHOOK_URL').replace(/\/$/, '');
const appSecret = requiredEnv('META_APP_SECRET');
const instagramAccountId = requiredEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID');
const proofId = randomUUID();
const createdTime = Math.floor(Date.now() / 1000);
const rawBody = Buffer.from(
  JSON.stringify({
    object: 'instagram',
    entry: [
      {
        id: instagramAccountId,
        changes: [
          {
            field: 'comments',
            value: {
              id: `shadow-proof-comment-${proofId}`,
              media_id: `shadow-proof-media-${proofId}`,
              from: { id: `shadow-proof-sender-${proofId}` },
              text: 'Que horas começa o Sunset?',
              created_time: createdTime,
            },
          },
        ],
      },
    ],
  }),
);
const normalized = parseMetaWebhookEvents(rawBody);
if (normalized.length !== 1 || !normalized[0]) throw new Error('SHADOW_PROOF_EVENT_NORMALIZATION_FAILED');
const eventId = normalized[0].eventId;
const signature = createHmac('sha256', appSecret).update(rawBody).digest('hex');

const response = await fetch(`${webhookUrl}/webhooks/meta`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-hub-signature-256': `sha256=${signature}`,
  },
  body: rawBody,
});
if (!response.ok) throw new Error(`SHADOW_PROOF_WEBHOOK_FAILED:${response.status}`);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const started = Date.now();
  let evidence:
    | {
        status: string;
        intent: string;
        risk: string;
        autonomy: string;
        faq_id: string | null;
        provider_reply_id: string | null;
      }
    | undefined;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await client.query<{
      status: string;
      intent: string;
      risk: string;
      autonomy: string;
      faq_id: string | null;
      provider_reply_id: string | null;
    }>(
      `select status, intent, risk, autonomy, faq_id, provider_reply_id
         from instagram_engagement_actions
        where event_id = $1`,
      [eventId],
    );
    evidence = result.rows[0];
    if (evidence) break;
    await sleep(5_000);
  }

  if (!evidence) throw new Error('SHADOW_PROOF_ACTION_NOT_OBSERVED');
  if (evidence.status !== 'SUGGESTED') {
    throw new Error(`SHADOW_PROOF_UNEXPECTED_STATUS:${evidence.status}`);
  }
  if (evidence.intent !== 'LOCATION_HOURS') {
    throw new Error(`SHADOW_PROOF_UNEXPECTED_INTENT:${evidence.intent}`);
  }
  if (evidence.autonomy !== 'SUGGEST_ONLY') {
    throw new Error(`SHADOW_PROOF_UNEXPECTED_AUTONOMY:${evidence.autonomy}`);
  }
  if (evidence.faq_id !== 'FAQ-001') {
    throw new Error(`SHADOW_PROOF_FAQ_NOT_RESOLVED:${evidence.faq_id ?? 'NONE'}`);
  }
  if (evidence.provider_reply_id) throw new Error('SHADOW_PROOF_EXTERNAL_REPLY_DETECTED');

  const inbound = await client.query<{ status: string }>(
    `select status from event_outbox
      where event_type = 'instagram.engagement.inbound.v1'
        and payload->>'eventId' = $1
      order by created_at desc
      limit 1`,
    [eventId],
  );
  if (inbound.rows[0]?.status !== 'DELIVERED') {
    throw new Error(`SHADOW_PROOF_INBOUND_NOT_DELIVERED:${inbound.rows[0]?.status ?? 'MISSING'}`);
  }

  const replies = await client.query<{ count: string }>(
    `select count(*)::text as count from event_outbox
      where event_type = 'instagram.engagement.reply.v1'
        and payload->>'engagementEventId' = $1`,
    [eventId],
  );
  if (Number(replies.rows[0]?.count ?? '0') !== 0) {
    throw new Error('SHADOW_PROOF_REPLY_EVENT_CREATED_WHILE_WRITES_DISABLED');
  }

  console.log(
    JSON.stringify({
      validation: 'instagram-engagement-shadow-e2e',
      status: 'PASS',
      webhookAccepted: true,
      inboundDelivered: true,
      actionStatus: evidence.status,
      intent: evidence.intent,
      risk: evidence.risk,
      autonomy: evidence.autonomy,
      faqResolved: evidence.faq_id === 'FAQ-001',
      externalReplyObserved: false,
      replyOutboxEvents: 0,
      writesEnabled: false,
      syntheticEvent: true,
      userIdentityPrinted: false,
      messageTextPrinted: false,
      elapsedSeconds: Math.ceil((Date.now() - started) / 1000),
    }),
  );
} finally {
  await client.end();
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
