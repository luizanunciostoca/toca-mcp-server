import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseMetaWebhookEvents } from '../providers/meta/meta-webhook.js';

const databaseUrl = requiredEnv('DATABASE_URL');
const webhookUrl = requiredEnv('INSTAGRAM_ENGAGEMENT_SHADOW_WEBHOOK_URL').replace(/\/$/, '');
const appSecret = requiredEnv('META_APP_SECRET');
const instagramAccountId = requiredEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID');

if (isTrue(process.env.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED)) {
  throw new Error('SHADOW_PROOF_REQUIRES_WRITES_DISABLED');
}

const proofId = randomUUID();
const started = Date.now();
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const results = [];
  for (const channel of ['COMMENT', 'DIRECT'] as const) {
    results.push(await runChannelProof(channel));
  }

  console.log(
    JSON.stringify({
      validation: 'instagram-engagement-shadow-e2e',
      status: 'PASS',
      channelsVerified: results.map((result) => result.channel),
      webhookAccepted: results.every((result) => result.webhookAccepted),
      inboundDelivered: results.every((result) => result.inboundDelivered),
      faqResolved: results.every((result) => result.faqResolved),
      externalReplyObserved: results.some((result) => result.externalReplyObserved),
      replyOutboxEvents: results.reduce((sum, result) => sum + result.replyOutboxEvents, 0),
      writesEnabled: false,
      syntheticEvents: results.length,
      userIdentityPrinted: false,
      messageTextPrinted: false,
      elapsedSeconds: Math.ceil((Date.now() - started) / 1000),
    }),
  );
} finally {
  await client.end();
}

type ShadowChannel = 'COMMENT' | 'DIRECT';

interface ShadowEvidence {
  readonly status: string;
  readonly intent: string;
  readonly risk: string;
  readonly autonomy: string;
  readonly faq_id: string | null;
  readonly provider_reply_id: string | null;
}

interface ShadowChannelResult {
  readonly channel: ShadowChannel;
  readonly webhookAccepted: true;
  readonly inboundDelivered: true;
  readonly faqResolved: true;
  readonly externalReplyObserved: false;
  readonly replyOutboxEvents: 0;
}

async function runChannelProof(channel: ShadowChannel): Promise<ShadowChannelResult> {
  const rawBody = buildSyntheticWebhook(channel);
  const normalized = parseMetaWebhookEvents(rawBody);
  if (normalized.length !== 1 || !normalized[0]) {
    throw new Error(`SHADOW_PROOF_${channel}_EVENT_NORMALIZATION_FAILED`);
  }
  if (normalized[0].channel !== channel) {
    throw new Error(`SHADOW_PROOF_${channel}_CHANNEL_NORMALIZATION_FAILED`);
  }
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
  if (!response.ok) throw new Error(`SHADOW_PROOF_${channel}_WEBHOOK_FAILED:${response.status}`);

  const evidence = await waitForEvidence(eventId, channel);
  assertExpectedShadowDecision(evidence, channel);

  const inbound = await client.query<{ status: string }>(
    `select status from event_outbox
      where event_type = 'instagram.engagement.inbound.v1'
        and payload->>'eventId' = $1
      order by created_at desc
      limit 1`,
    [eventId],
  );
  if (inbound.rows[0]?.status !== 'DELIVERED') {
    throw new Error(
      `SHADOW_PROOF_${channel}_INBOUND_NOT_DELIVERED:${inbound.rows[0]?.status ?? 'MISSING'}`,
    );
  }

  const replies = await client.query<{ count: string }>(
    `select count(*)::text as count from event_outbox
      where event_type = 'instagram.engagement.reply.v1'
        and payload->>'engagementEventId' = $1`,
    [eventId],
  );
  const replyCount = Number(replies.rows[0]?.count ?? '0');
  if (replyCount !== 0) {
    throw new Error(`SHADOW_PROOF_${channel}_REPLY_EVENT_CREATED_WHILE_WRITES_DISABLED`);
  }

  return {
    channel,
    webhookAccepted: true,
    inboundDelivered: true,
    faqResolved: true,
    externalReplyObserved: false,
    replyOutboxEvents: 0,
  };
}

function buildSyntheticWebhook(channel: ShadowChannel): Buffer {
  const createdSeconds = Math.floor(Date.now() / 1000);

  if (channel === 'COMMENT') {
    return Buffer.from(
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
                  from: { id: `shadow-proof-comment-sender-${proofId}` },
                  text: 'Que horas começa o Sunset?',
                  created_time: createdSeconds,
                },
              },
            ],
          },
        ],
      }),
    );
  }

  return Buffer.from(
    JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: instagramAccountId,
          messaging: [
            {
              sender: { id: `shadow-proof-direct-sender-${proofId}` },
              recipient: { id: instagramAccountId },
              timestamp: Date.now(),
              message: {
                mid: `shadow-proof-direct-${proofId}`,
                text: 'Que horas começa o Sunset?',
              },
            },
          ],
        },
      ],
    }),
  );
}

async function waitForEvidence(eventId: string, channel: ShadowChannel): Promise<ShadowEvidence> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await client.query<ShadowEvidence>(
      `select status, intent, risk, autonomy, faq_id, provider_reply_id
         from instagram_engagement_actions
        where event_id = $1`,
      [eventId],
    );
    const evidence = result.rows[0];
    if (evidence) return evidence;
    await sleep(5_000);
  }

  throw new Error(`SHADOW_PROOF_${channel}_ACTION_NOT_OBSERVED`);
}

function assertExpectedShadowDecision(evidence: ShadowEvidence, channel: ShadowChannel): void {
  if (evidence.status !== 'SUGGESTED') {
    throw new Error(`SHADOW_PROOF_${channel}_UNEXPECTED_STATUS:${evidence.status}`);
  }
  if (evidence.intent !== 'LOCATION_HOURS') {
    throw new Error(`SHADOW_PROOF_${channel}_UNEXPECTED_INTENT:${evidence.intent}`);
  }
  if (evidence.autonomy !== 'SUGGEST_ONLY') {
    throw new Error(`SHADOW_PROOF_${channel}_UNEXPECTED_AUTONOMY:${evidence.autonomy}`);
  }
  if (evidence.faq_id !== 'FAQ-001') {
    throw new Error(`SHADOW_PROOF_${channel}_FAQ_NOT_RESOLVED:${evidence.faq_id ?? 'NONE'}`);
  }
  if (evidence.provider_reply_id) {
    throw new Error(`SHADOW_PROOF_${channel}_EXTERNAL_REPLY_DETECTED`);
  }
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
