import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import pg from 'pg';

type JsonObject = Record<string, unknown>;
type RpcReply = {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');

const child = spawn(process.execPath, ['dist/src/index.js'], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const providerErrors = new Map<string, number>();
const executionFailures = new Map<string, number>();

createInterface({ input: child.stdout }).on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let reply: RpcReply;
  try {
    reply = JSON.parse(trimmed) as RpcReply;
  } catch {
    return;
  }
  if (typeof reply.id !== 'number') return;
  const waiter = pending.get(reply.id);
  if (!waiter) return;
  pending.delete(reply.id);
  if (reply.error) {
    waiter.reject(new Error(`MCP_RPC_ERROR:${reply.error.code ?? 'UNKNOWN'}`));
    return;
  }
  waiter.resolve(reply.result);
});

createInterface({ input: child.stderr }).on('line', (line) => {
  try {
    const event = JSON.parse(line) as JsonObject;
    if (event.event !== 'instagram.messaging.read.provider_error') return;
    const operation = typeof event.operation === 'string' ? event.operation : 'unknown';
    const httpStatus = typeof event.httpStatus === 'number' ? event.httpStatus : null;
    const providerCode = typeof event.providerCode === 'number' ? event.providerCode : null;
    const providerSubcode = typeof event.providerSubcode === 'number' ? event.providerSubcode : null;
    const key = JSON.stringify({ operation, httpStatus, providerCode, providerSubcode });
    providerErrors.set(key, (providerErrors.get(key) ?? 0) + 1);
  } catch {
    // Intentionally discard raw server stderr.
  }
});

function send(method: string, params: JsonObject): Promise<unknown> {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP_TIMEOUT:${method}`));
    }, 90000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
}

function notify(method: string, params: JsonObject): void {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

function safeErrorCategory(value: unknown): string {
  const text = String(value ?? '').toUpperCase();
  const known = [
    'CAPABILITY_NOT_FOUND',
    'CAPABILITY_NOT_EXECUTABLE',
    'RUNTIME_BINDING_NOT_FOUND',
    'RUNTIME_BINDING_UNAVAILABLE',
    'POLICY_DENIED',
    'IDENTITY_REQUIRED',
    'TENANT_ID_REQUIRED',
    'WORKSPACE_ID_REQUIRED',
    'ORGANIZATION_ID_REQUIRED',
    'APPROVAL_REQUIRED',
    'INVALID_ARGUMENT',
    'VALIDATION',
    'MCP_RPC_ERROR',
    'MCP_TIMEOUT',
    'META_HTTP_400',
    'META_SUBCODE_2534084',
    'INSTAGRAM_MESSAGING_CURSOR_UNSAFE',
  ];
  for (const token of known) if (text.includes(token)) return token;
  const token = text.match(/[A-Z][A-Z0-9_]{3,}/)?.[0];
  return token ?? 'UNKNOWN';
}

function recordFailure(error: unknown): void {
  const category = safeErrorCategory(error instanceof Error ? error.message : error);
  executionFailures.set(category, (executionFailures.get(category) ?? 0) + 1);
}

function structured(result: unknown): JsonObject {
  const value = result as {
    isError?: boolean;
    structuredContent?: JsonObject;
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = value?.content?.find((item) => item.type === 'text')?.text;
  if (value?.isError) throw new Error(safeErrorCategory(text ?? 'MCP_TOOL_ERROR'));
  if (value?.structuredContent && typeof value.structuredContent === 'object') {
    return value.structuredContent;
  }
  if (text) {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as JsonObject;
  }
  throw new Error('MCP_STRUCTURED_RESULT_REQUIRED');
}

async function callTool(name: string, args: JsonObject): Promise<JsonObject> {
  return structured(await send('tools/call', { name, arguments: args }));
}

async function persistedSenderIds(): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query<{ sender_scoped_id: string }>(`
      SELECT DISTINCT sender_scoped_id
      FROM meta_webhook_events
      WHERE NULLIF(BTRIM(sender_scoped_id), '') IS NOT NULL
      ORDER BY sender_scoped_id
      LIMIT 100
    `);
    await client.query('ROLLBACK');
    return result.rows.map((row) => row.sender_scoped_id).filter(Boolean);
  } finally {
    await client.end();
  }
}

function updateRange(value: string, state: { oldest: string | null; newest: string | null }): void {
  if (!value) return;
  if (!state.oldest || value < state.oldest) state.oldest = value;
  if (!state.newest || value > state.newest) state.newest = value;
}

async function main(): Promise<void> {
  const initialized = (await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'toca-os-instagram-webhook-user-probe', version: '3.0.0' },
  })) as { serverInfo?: { name?: string }; protocolVersion?: string };
  notify('notifications/initialized', {});

  const senderIds = await persistedSenderIds();
  const inboundByYear = new Map<string, number>();
  const timestampRange = { oldest: null as string | null, newest: null as string | null };
  let probesAttempted = 0;
  let successfulConversationCalls = 0;
  let conversationsFound = 0;
  let messageReadsSucceeded = 0;
  let messagePagesRead = 0;
  let messagesReturned = 0;
  let duplicateMessagesAcrossPages = 0;
  let inboundMessages = 0;
  let inboundMessages2025 = 0;
  let inboundMessagesWithText2025 = 0;
  let conversationsFullyPaginated = 0;
  let conversationsCoveredThrough2025 = 0;
  let conversationsNeedingOlderPageButBlocked = 0;
  let conversationsStoppedByPageLimit = 0;
  let conversationsStoppedByCursorCycle = 0;
  const MAX_PAGES_PER_CONVERSATION = 100;
  const START_2025 = '2025-01-01';
  const START_2026 = '2026-01-01';

  for (const userId of senderIds) {
    probesAttempted += 1;
    try {
      const execution = await callTool('toca.execute', {
        capabilityId: 'instagram.messaging.conversations.read',
        payload: { limit: 1, userId },
        correlationId: `instagram-dm-webhook-user-${Date.now()}-${probesAttempted}`,
      });
      successfulConversationCalls += 1;
      const result = asRecord(execution.result);
      const conversations = arrayOfRecords(result.conversations);
      conversationsFound += conversations.length;

      for (const conversation of conversations) {
        const conversationId = scalar(conversation.conversationId);
        if (!conversationId) continue;
        const seenCursors = new Set<string>();
        const seenMessageIds = new Set<string>();
        let after: string | undefined;
        let fullyPaginated = false;
        let coveredThrough2025 = false;
        let pageFailed = false;

        for (let page = 1; page <= MAX_PAGES_PER_CONVERSATION; page += 1) {
          try {
            const messagesExecution = await callTool('toca.execute', {
              capabilityId: 'instagram.messaging.messages.read',
              payload: { conversationId, limit: 20, ...(after ? { after } : {}) },
              correlationId: `instagram-dm-webhook-msg-${Date.now()}-${probesAttempted}-${page}`,
            });
            messageReadsSucceeded += 1;
            messagePagesRead += 1;
            const messagesResult = asRecord(messagesExecution.result);
            const messages = arrayOfRecords(messagesResult.messages);
            messagesReturned += messages.length;
            let oldestOnPage: string | null = null;

            for (const message of messages) {
              const messageId = scalar(message.messageId);
              if (messageId) {
                if (seenMessageIds.has(messageId)) duplicateMessagesAcrossPages += 1;
                seenMessageIds.add(messageId);
              }
              const createdTime = scalar(message.createdTime);
              updateRange(createdTime, timestampRange);
              if (createdTime && (!oldestOnPage || createdTime < oldestOnPage)) oldestOnPage = createdTime;
              if (message.direction !== 'INBOUND') continue;
              inboundMessages += 1;
              const year = createdTime.slice(0, 4);
              if (/^\d{4}$/.test(year)) inboundByYear.set(year, (inboundByYear.get(year) ?? 0) + 1);
              if (createdTime >= START_2025 && createdTime < START_2026) {
                inboundMessages2025 += 1;
                if (scalar(message.text).trim()) inboundMessagesWithText2025 += 1;
              }
            }

            // Meta returns conversation messages newest-first. Once this page reaches
            // a date before 2025, any later page is older and cannot contain 2025.
            if (oldestOnPage && oldestOnPage < START_2025) {
              coveredThrough2025 = true;
              break;
            }

            const nextAfter = scalar(messagesResult.nextAfter);
            if (!nextAfter) {
              fullyPaginated = true;
              coveredThrough2025 = true;
              break;
            }
            if (seenCursors.has(nextAfter)) {
              conversationsStoppedByCursorCycle += 1;
              break;
            }
            seenCursors.add(nextAfter);
            after = nextAfter;
          } catch (error) {
            recordFailure(error);
            pageFailed = true;
            break;
          }
        }

        if (fullyPaginated) conversationsFullyPaginated += 1;
        if (coveredThrough2025) conversationsCoveredThrough2025 += 1;
        if (pageFailed && !coveredThrough2025) conversationsNeedingOlderPageButBlocked += 1;
        if (!fullyPaginated && !coveredThrough2025 && seenCursors.size >= MAX_PAGES_PER_CONVERSATION) {
          conversationsStoppedByPageLimit += 1;
        }
      }
    } catch (error) {
      recordFailure(error);
    }
  }

  console.log(
    JSON.stringify({
      validation: 'instagram-dm-webhook-user-probe-v3',
      senderSource: 'meta_webhook_events:all_channels',
      mcpServer: initialized.serverInfo?.name ?? null,
      protocolVersion: initialized.protocolVersion ?? null,
      persistedSenderIdsAvailable: senderIds.length,
      probesAttempted,
      successfulConversationCalls,
      conversationsFound,
      messageReadsSucceeded,
      messagePagesRead,
      messagesReturned,
      duplicateMessagesAcrossPages,
      inboundMessages,
      inboundMessages2025,
      inboundMessagesWithText2025,
      inboundByYear: [...inboundByYear.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([year, count]) => ({ year, count })),
      oldestMessageTime: timestampRange.oldest,
      newestMessageTime: timestampRange.newest,
      conversationsFullyPaginated,
      conversationsCoveredThrough2025,
      conversationsNeedingOlderPageButBlocked,
      conversationsStoppedByPageLimit,
      conversationsStoppedByCursorCycle,
      executionFailures: [...executionFailures.entries()].map(([category, count]) => ({ category, count })),
      providerErrors: [...providerErrors.entries()].map(([key, count]) => ({ ...JSON.parse(key), count })),
      identitiesPrinted: false,
      messageTextPrinted: false,
      writesEnabled: false,
    }),
  );
}

function asRecord(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

function arrayOfRecords(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asRecord).filter((row) => Object.keys(row).length > 0) : [];
}

function scalar(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

main()
  .catch((error) => {
    const code = safeErrorCategory(error instanceof Error ? error.message : error);
    console.log(
      JSON.stringify({
        validation: 'instagram-dm-webhook-user-probe-v3',
        status: 'FAILED',
        errorCode: code,
        identitiesPrinted: false,
        messageTextPrinted: false,
        writesEnabled: false,
      }),
    );
    process.exitCode = 1;
  })
  .finally(() => child.kill('SIGTERM'));
