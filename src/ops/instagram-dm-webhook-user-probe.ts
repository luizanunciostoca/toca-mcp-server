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

function structured(result: unknown): JsonObject {
  const value = result as {
    isError?: boolean;
    structuredContent?: JsonObject;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (value?.isError) throw new Error('MCP_TOOL_ERROR');
  if (value?.structuredContent && typeof value.structuredContent === 'object') {
    return value.structuredContent;
  }
  const text = value?.content?.find((item) => item.type === 'text')?.text;
  if (text) {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as JsonObject;
  }
  throw new Error('MCP_STRUCTURED_RESULT_REQUIRED');
}

async function callTool(name: string, args: JsonObject): Promise<JsonObject> {
  return structured(await send('tools/call', { name, arguments: args }));
}

async function webhookSenderIds(): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query<{ sender_scoped_id: string }>(`
      SELECT DISTINCT sender_scoped_id
      FROM meta_webhook_events
      WHERE NULLIF(BTRIM(sender_scoped_id), '') IS NOT NULL
        AND NULLIF(BTRIM(provider_message_id), '') IS NOT NULL
      LIMIT 50
    `);
    await client.query('ROLLBACK');
    return result.rows.map((row) => row.sender_scoped_id).filter(Boolean);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const initialized = (await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'toca-os-instagram-webhook-user-probe', version: '1.0.0' },
  })) as { serverInfo?: { name?: string }; protocolVersion?: string };
  notify('notifications/initialized', {});

  const senderIds = await webhookSenderIds();
  let probesAttempted = 0;
  let successfulConversationCalls = 0;
  let conversationsFound = 0;
  let messageReadsSucceeded = 0;
  let messagesReturned = 0;
  let inboundMessages = 0;
  let inboundMessages2025 = 0;
  let inboundMessagesWithText2025 = 0;
  let conversationsWithProviderHasMore = 0;

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
        try {
          const messagesExecution = await callTool('toca.execute', {
            capabilityId: 'instagram.messaging.messages.read',
            payload: { conversationId, limit: 20 },
            correlationId: `instagram-dm-webhook-msg-${Date.now()}-${probesAttempted}`,
          });
          messageReadsSucceeded += 1;
          const messagesResult = asRecord(messagesExecution.result);
          const messages = arrayOfRecords(messagesResult.messages);
          messagesReturned += messages.length;
          if (messagesResult.providerHasMore === true) conversationsWithProviderHasMore += 1;
          for (const message of messages) {
            if (message.direction !== 'INBOUND') continue;
            inboundMessages += 1;
            const createdTime = scalar(message.createdTime);
            if (createdTime && createdTime >= '2025-01-01' && createdTime < '2026-01-01') {
              inboundMessages2025 += 1;
              if (scalar(message.text).trim()) inboundMessagesWithText2025 += 1;
            }
          }
        } catch {
          // Aggregate only. Do not emit conversation IDs or message content.
        }
      }
    } catch {
      // Aggregate only. Do not emit sender IDs or raw provider messages.
    }
  }

  console.log(
    JSON.stringify({
      validation: 'instagram-dm-webhook-user-probe',
      mcpServer: initialized.serverInfo?.name ?? null,
      protocolVersion: initialized.protocolVersion ?? null,
      webhookSenderIdsAvailable: senderIds.length,
      probesAttempted,
      successfulConversationCalls,
      conversationsFound,
      messageReadsSucceeded,
      messagesReturned,
      inboundMessages,
      inboundMessages2025,
      inboundMessagesWithText2025,
      conversationsWithProviderHasMore,
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
    const code = error instanceof Error ? error.message.replace(/[^A-Z0-9:_-]/gi, '_').slice(0, 160) : 'UNKNOWN';
    console.log(
      JSON.stringify({
        validation: 'instagram-dm-webhook-user-probe',
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
