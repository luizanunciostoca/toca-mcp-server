import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseMetaWebhookEvents } from '../providers/meta/meta-webhook.js';

const databaseUrl = requiredEnv('DATABASE_URL');
const webhookUrl = requiredEnv('INSTAGRAM_ENGAGEMENT_SHADOW_WEBHOOK_URL').replace(/\/$/, '');
const appSecret = requiredEnv('META_APP_SECRET');
const instagramAccountId = requiredEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID');

if (isTrue(process.env.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED)) {
  throw new Error('CONVERSATION_SHADOW_PROOF_REQUIRES_WRITES_DISABLED');
}

const proofId = randomUUID();
const client = new pg.Client({ connectionString: databaseUrl });

interface ActionRow {
  readonly event_id: string;
  readonly status: string;
  readonly intent: string;
  readonly autonomy: string;
  readonly classification_confidence: string | null;
  readonly priority: string | null;
  readonly thread_id: string | null;
  readonly message_group_sha256: string | null;
  readonly provider_reply_id: string | null;
}

interface GroupRow {
  readonly group_sha256: string;
  readonly thread_id: string;
  readonly event_ids: string[];
  readonly message_count: number;
  readonly status: string;
}

interface ThreadRow {
  readonly thread_id: string;
  readonly state: string;
  readonly priority: string;
  readonly classification_confidence: string;
  readonly grouped_message_count: number;
}

await client.connect();
try {
  const groupedSender = `shadow-conversation-group-${proofId}`;
  const lowSender = `shadow-conversation-low-${proofId}`;
  const p0Sender = `shadow-conversation-p0-${proofId}`;

  const groupedFirst = await sendDirect(groupedSender, `group-1-${proofId}`, 'Que horas começa');
  const groupedSecond = await sendDirect(groupedSender, `group-2-${proofId}`, 'o Sunset?');
  const lowEvent = await sendDirect(lowSender, `low-${proofId}`, 'Qual é a cor do teto?');
  const p0Event = await sendDirect(
    p0Sender,
    `p0-${proofId}`,
    'Fui agredido e estou sendo ameaçado agora',
  );

  const groupedAction = await waitForGroupedAction([groupedFirst, groupedSecond]);
  const lowAction = await waitForAction(lowEvent);
  const p0Action = await waitForAction(p0Event);

  const grouped = await client.query<GroupRow>(
    `select group_sha256, thread_id, event_ids, message_count, status
       from instagram_engagement_message_groups
      where group_sha256 = $1`,
    [requiredValue(groupedAction.message_group_sha256, 'GROUP_MESSAGE_SHA_MISSING')],
  );
  const groupedRow = grouped.rows[0];
  if (!groupedRow) throw new Error('CONVERSATION_SHADOW_GROUP_NOT_FOUND');
  if (groupedRow.message_count !== 2) {
    throw new Error(`CONVERSATION_SHADOW_GROUP_COUNT_INVALID:${groupedRow.message_count}`);
  }
  if (![groupedFirst, groupedSecond].every((eventId) => groupedRow.event_ids.includes(eventId))) {
    throw new Error('CONVERSATION_SHADOW_GROUP_EVENT_SET_INVALID');
  }

  const groupedActionCount = await actionCount([groupedFirst, groupedSecond]);
  if (groupedActionCount !== 1) {
    throw new Error(`CONVERSATION_SHADOW_GROUP_DECISION_COUNT_INVALID:${groupedActionCount}`);
  }

  if (lowAction.classification_confidence !== 'LOW') {
    throw new Error(
      `CONVERSATION_SHADOW_LOW_CONFIDENCE_INVALID:${lowAction.classification_confidence ?? 'NULL'}`,
    );
  }
  if (lowAction.status === 'READY_TO_SEND' || lowAction.status === 'SENT') {
    throw new Error(`CONVERSATION_SHADOW_LOW_AUTOSEND_ALLOWED:${lowAction.status}`);
  }

  if (p0Action.priority !== 'P0') {
    throw new Error(`CONVERSATION_SHADOW_P0_PRIORITY_INVALID:${p0Action.priority ?? 'NULL'}`);
  }
  if (p0Action.status !== 'HUMAN_REVIEW') {
    throw new Error(`CONVERSATION_SHADOW_P0_STATUS_INVALID:${p0Action.status}`);
  }

  const p0Thread = await thread(requiredValue(p0Action.thread_id, 'P0_THREAD_ID_MISSING'));
  if (p0Thread.state !== 'ESCALATED') {
    throw new Error(`CONVERSATION_SHADOW_P0_THREAD_NOT_ESCALATED:${p0Thread.state}`);
  }
  if (p0Thread.priority !== 'P0') {
    throw new Error(`CONVERSATION_SHADOW_P0_THREAD_PRIORITY_INVALID:${p0Thread.priority}`);
  }

  const allEvents = [groupedFirst, groupedSecond, lowEvent, p0Event];
  const replyOutboxEvents = await replyCount(allEvents);
  const providerReplyCount = [groupedAction, lowAction, p0Action].filter(
    (action) => action.provider_reply_id,
  ).length;
  if (replyOutboxEvents !== 0 || providerReplyCount !== 0) {
    throw new Error(
      `CONVERSATION_SHADOW_EXTERNAL_REPLY_BOUNDARY_FAILED:${replyOutboxEvents}:${providerReplyCount}`,
    );
  }

  console.log(
    JSON.stringify({
      validation: 'instagram-conversation-shadow-e2e',
      status: 'PASS',
      grouping: {
        inboundEvents: 2,
        persistedGroups: 1,
        decisions: groupedActionCount,
        messageCount: groupedRow.message_count,
      },
      lowConfidence: {
        confidence: lowAction.classification_confidence,
        status: lowAction.status,
        autoSendObserved: false,
      },
      p0: {
        priority: p0Action.priority,
        actionStatus: p0Action.status,
        threadState: p0Thread.state,
      },
      replyOutboxEvents,
      externalReplyObserved: false,
      writesEnabled: false,
      messageTextPrinted: false,
      userIdentityPrinted: false,
      secretsPrinted: false,
    }),
  );
} finally {
  await client.end();
}

async function sendDirect(senderId: string, messageId: string, text: string): Promise<string> {
  const rawBody = Buffer.from(
    JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: instagramAccountId,
          messaging: [
            {
              sender: { id: senderId },
              recipient: { id: instagramAccountId },
              timestamp: Date.now(),
              message: { mid: messageId, text },
            },
          ],
        },
      ],
    }),
  );
  const normalized = parseMetaWebhookEvents(rawBody);
  const event = normalized[0];
  if (normalized.length !== 1 || !event || event.channel !== 'DIRECT') {
    throw new Error('CONVERSATION_SHADOW_EVENT_NORMALIZATION_FAILED');
  }
  const signature = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const response = await fetch(`${webhookUrl}/webhooks/meta`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    body: rawBody.toString('utf8'),
  });
  if (!response.ok) {
    throw new Error(`CONVERSATION_SHADOW_WEBHOOK_FAILED:${response.status}`);
  }
  return event.eventId;
}

async function waitForGroupedAction(eventIds: readonly string[]): Promise<ActionRow> {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const result = await client.query<ActionRow>(
      `select event_id, status, intent, autonomy, classification_confidence, priority,
              thread_id, message_group_sha256, provider_reply_id
         from instagram_engagement_actions
        where event_id = any($1::text[])
        order by created_at asc`,
      [eventIds],
    );
    if (result.rows.length === 1 && result.rows[0]?.message_group_sha256) return result.rows[0];
    if (result.rows.length > 1) {
      throw new Error(`CONVERSATION_SHADOW_GROUP_DUPLICATE_DECISIONS:${result.rows.length}`);
    }
    await sleep(4_000);
  }
  throw new Error('CONVERSATION_SHADOW_GROUP_ACTION_NOT_OBSERVED');
}

async function waitForAction(eventId: string): Promise<ActionRow> {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const result = await client.query<ActionRow>(
      `select event_id, status, intent, autonomy, classification_confidence, priority,
              thread_id, message_group_sha256, provider_reply_id
         from instagram_engagement_actions
        where event_id = $1`,
      [eventId],
    );
    if (result.rows[0]) return result.rows[0];
    await sleep(4_000);
  }
  throw new Error(`CONVERSATION_SHADOW_ACTION_NOT_OBSERVED:${eventId.slice(0, 12)}`);
}

async function actionCount(eventIds: readonly string[]): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count
       from instagram_engagement_actions
      where event_id = any($1::text[])`,
    [eventIds],
  );
  return Number(result.rows[0]?.count ?? '0');
}

async function replyCount(eventIds: readonly string[]): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count
       from event_outbox
      where event_type = 'instagram.engagement.reply.v1'
        and payload->>'engagementEventId' = any($1::text[])`,
    [eventIds],
  );
  return Number(result.rows[0]?.count ?? '0');
}

async function thread(threadId: string): Promise<ThreadRow> {
  const result = await client.query<ThreadRow>(
    `select thread_id, state, priority, classification_confidence, grouped_message_count
       from instagram_engagement_threads
      where thread_id = $1`,
    [threadId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('CONVERSATION_SHADOW_THREAD_NOT_FOUND');
  return row;
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
}

function requiredValue(value: string | null, code: string): string {
  if (!value) throw new Error(code);
  return value;
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
