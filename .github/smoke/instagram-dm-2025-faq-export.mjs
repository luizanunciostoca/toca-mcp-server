import crypto from 'node:crypto';

const GRAPH_BASE = 'https://graph.facebook.com/v24.0';
const accountId = process.env.INSTAGRAM_ACCOUNT_ID?.trim();
const userToken = process.env.META_ACCESS_TOKEN?.trim();
const exportKeyHex = process.env.EXPORT_KEY_HEX?.trim();

if (!accountId || !userToken || !exportKeyHex) {
  throw new Error('INSTAGRAM_DM_EXPORT_CONFIGURATION_MISSING');
}
if (!/^[a-f0-9]{64}$/i.test(exportKeyHex)) {
  throw new Error('INSTAGRAM_DM_EXPORT_KEY_INVALID');
}

const PERIOD_START = Date.parse('2025-01-01T00:00:00Z');
const PERIOD_END = Date.parse('2026-01-01T00:00:00Z');
const MAX_CONVERSATION_PAGES = 500;
const CONVERSATION_PAGE_LIMIT = 100;
const MESSAGE_DETAIL_LIMIT = 20;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function timestamp(value) {
  const text = asString(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

async function graphGet(path, token, query = {}) {
  const url = new URL(`${GRAPH_BASE}/${String(path).replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = asObject(asObject(body).error);
    const code = typeof error.code === 'number' ? error.code : response.status;
    const subcode = typeof error.error_subcode === 'number' ? error.error_subcode : 0;
    const type = asString(error.type)?.replace(/[^A-Za-z0-9_-]/g, '') ?? 'UNKNOWN';
    throw new Error(`META_GRAPH_READ_FAILED:${code}:${subcode}:${type}`);
  }
  return body;
}

async function resolvePage() {
  const body = asObject(
    await graphGet('me/accounts', userToken, {
      fields: 'id,access_token,tasks,instagram_business_account',
      limit: 100,
    }),
  );
  const matches = asArray(body.data).filter((candidate) => {
    const page = asObject(candidate);
    const linked = asObject(page.instagram_business_account);
    return linked.id === accountId;
  });
  if (matches.length !== 1) throw new Error(`INSTAGRAM_PAGE_MATCH_COUNT:${matches.length}`);
  const page = asObject(matches[0]);
  const tasks = asArray(page.tasks);
  if (!tasks.includes('MESSAGING')) throw new Error('INSTAGRAM_PAGE_MESSAGING_TASK_MISSING');
  const pageId = asString(page.id);
  const pageToken = asString(page.access_token);
  if (!pageId || !pageToken) throw new Error('INSTAGRAM_PAGE_ROUTE_INCOMPLETE');
  return { pageId, pageToken };
}

async function listAllConversations(pageId, pageToken) {
  const conversations = [];
  let after = null;
  let pages = 0;
  do {
    pages += 1;
    if (pages > MAX_CONVERSATION_PAGES) throw new Error('INSTAGRAM_CONVERSATION_PAGE_GUARD_EXCEEDED');
    const body = asObject(
      await graphGet(`${pageId}/conversations`, pageToken, {
        fields: 'id,updated_time',
        limit: CONVERSATION_PAGE_LIMIT,
        ...(after ? { after } : {}),
      }),
    );
    conversations.push(...asArray(body.data));
    after = asString(asObject(asObject(body.paging).cursors).after);
  } while (after);
  return { conversations, pages };
}

async function readConversation(conversationId, pageToken) {
  const fields = `messages.limit(${MESSAGE_DETAIL_LIMIT}){id,created_time,from,to,message,is_unsupported}`;
  const body = asObject(await graphGet(conversationId, pageToken, { fields }));
  const messages = asObject(body.messages);
  return {
    data: asArray(messages.data),
    hasMore: Boolean(asString(asObject(messages.paging).next) || asString(asObject(asObject(messages.paging).cursors).after)),
  };
}

function touchesInstagramAccount(message) {
  const fromId = asString(asObject(message.from).id);
  const toIds = asArray(asObject(message.to).data)
    .map((recipient) => asString(asObject(recipient).id))
    .filter(Boolean);
  return fromId === accountId || toIds.includes(accountId);
}

function directionFor(message, pageId) {
  const fromId = asString(asObject(message.from).id);
  if (!fromId) return 'UNKNOWN';
  if (fromId === accountId || fromId === pageId) return 'OUTBOUND';
  return 'INBOUND';
}

function inPeriod(timeMs) {
  return timeMs !== null && timeMs >= PERIOD_START && timeMs < PERIOD_END;
}

const { pageId, pageToken } = await resolvePage();
const { conversations, pages: conversationPages } = await listAllConversations(pageId, pageToken);

const exportedMessages = [];
let conversationsSkippedBefore2025 = 0;
let conversationsInspected = 0;
let conversationsRejectedAsNonInstagram = 0;
let conversationsWithMoreThan20Messages = 0;
let conversationsPotentiallyMissing2025DueMetaLimit = 0;
let conversationReadErrors = 0;
let inspectedMessageRecords = 0;
let inbound2025Messages = 0;
let outbound2025Messages = 0;
let unknownDirection2025Messages = 0;
let messagesWithoutText2025 = 0;
let earliestInspected = null;
let latestInspected = null;

for (const candidate of conversations) {
  const conversation = asObject(candidate);
  const conversationId = asString(conversation.id);
  const updated = timestamp(conversation.updated_time);
  if (!conversationId) continue;
  if (updated !== null && updated < PERIOD_START) {
    conversationsSkippedBefore2025 += 1;
    continue;
  }

  conversationsInspected += 1;
  let read;
  try {
    read = await readConversation(conversationId, pageToken);
  } catch {
    conversationReadErrors += 1;
    continue;
  }

  const instagramMessages = read.data.filter((message) => touchesInstagramAccount(asObject(message)));
  if (read.data.length > 0 && instagramMessages.length === 0) {
    conversationsRejectedAsNonInstagram += 1;
    continue;
  }

  const inspectedTimes = [];
  for (const candidateMessage of instagramMessages) {
    const message = asObject(candidateMessage);
    inspectedMessageRecords += 1;
    const createdMs = timestamp(message.created_time);
    if (createdMs !== null) {
      inspectedTimes.push(createdMs);
      earliestInspected = earliestInspected === null ? createdMs : Math.min(earliestInspected, createdMs);
      latestInspected = latestInspected === null ? createdMs : Math.max(latestInspected, createdMs);
    }
    if (!inPeriod(createdMs)) continue;

    const direction = directionFor(message, pageId);
    if (direction === 'OUTBOUND') {
      outbound2025Messages += 1;
      continue;
    }
    if (direction === 'UNKNOWN') {
      unknownDirection2025Messages += 1;
      continue;
    }

    inbound2025Messages += 1;
    const text = asString(message.message);
    if (!text) {
      messagesWithoutText2025 += 1;
      continue;
    }
    exportedMessages.push({
      createdTime: new Date(createdMs).toISOString(),
      text,
    });
  }

  if (read.hasMore && instagramMessages.length > 0) {
    conversationsWithMoreThan20Messages += 1;
    const earliestConversationInspected = inspectedTimes.length > 0 ? Math.min(...inspectedTimes) : null;
    if (
      earliestConversationInspected === null ||
      (earliestConversationInspected > PERIOD_START && (updated === null || updated >= PERIOD_START))
    ) {
      conversationsPotentiallyMissing2025DueMetaLimit += 1;
    }
  }
}

const coverage = {
  period: { start: '2025-01-01T00:00:00.000Z', endExclusive: '2026-01-01T00:00:00.000Z' },
  conversationPages,
  conversationsReturned: conversations.length,
  conversationsSkippedBefore2025,
  conversationsInspected,
  conversationsRejectedAsNonInstagram,
  conversationsWithMoreThan20Messages,
  conversationsPotentiallyMissing2025DueMetaLimit,
  conversationReadErrors,
  inspectedMessageRecords,
  inbound2025Messages,
  outbound2025Messages,
  unknownDirection2025Messages,
  messagesWithoutText2025,
  exportedInboundTextMessages2025: exportedMessages.length,
  earliestInspectedMessageTime: earliestInspected === null ? null : new Date(earliestInspected).toISOString(),
  latestInspectedMessageTime: latestInspected === null ? null : new Date(latestInspected).toISOString(),
  metaMessageDetailLimitPerConversation: MESSAGE_DETAIL_LIMIT,
  completeHistoricalCoverageClaimAllowed:
    conversationReadErrors === 0 && conversationsPotentiallyMissing2025DueMetaLimit === 0,
};

const payload = {
  schemaVersion: 1,
  source: 'instagram-direct-meta-conversations-api',
  generatedAt: new Date().toISOString(),
  coverage,
  messages: exportedMessages,
};

const key = Buffer.from(exportKeyHex, 'hex');
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();
const encoded = ciphertext.toString('base64');
const chunkSize = 100_000;
const chunks = [];
for (let offset = 0; offset < encoded.length; offset += chunkSize) {
  chunks.push(encoded.slice(offset, offset + chunkSize));
}

console.log(JSON.stringify({ validation: 'instagram-dm-2025-export-coverage', coverage }));
chunks.forEach((chunk, chunkIndex) => {
  console.log(
    JSON.stringify({
      validation: 'instagram-dm-2025-export-chunk',
      chunkIndex,
      totalChunks: chunks.length,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      chunk,
    }),
  );
});
