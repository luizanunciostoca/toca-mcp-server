import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import pg from 'pg';

type JsonObject = Record<string, unknown>;
type RpcReply = { jsonrpc: '2.0'; id?: number; result?: unknown; error?: { code?: number } };

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');

const child = spawn(process.execPath, ['dist/src/index.js'], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const providerErrors = new Map<string, number>();

createInterface({ input: child.stdout }).on('line', (line) => {
  let reply: RpcReply;
  try { reply = JSON.parse(line.trim()) as RpcReply; } catch { return; }
  if (typeof reply.id !== 'number') return;
  const waiter = pending.get(reply.id);
  if (!waiter) return;
  pending.delete(reply.id);
  if (reply.error) waiter.reject(new Error(`MCP_RPC_ERROR:${reply.error.code ?? 'UNKNOWN'}`));
  else waiter.resolve(reply.result);
});

createInterface({ input: child.stderr }).on('line', (line) => {
  try {
    const event = JSON.parse(line) as JsonObject;
    if (event.event !== 'instagram.messaging.read.provider_error') return;
    const key = JSON.stringify({
      operation: typeof event.operation === 'string' ? event.operation : 'unknown',
      httpStatus: typeof event.httpStatus === 'number' ? event.httpStatus : null,
      providerCode: typeof event.providerCode === 'number' ? event.providerCode : null,
      providerSubcode: typeof event.providerSubcode === 'number' ? event.providerSubcode : null,
    });
    providerErrors.set(key, (providerErrors.get(key) ?? 0) + 1);
  } catch { /* discard raw stderr */ }
});

function send(method: string, params: JsonObject): Promise<unknown> {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP_TIMEOUT')); }, 90000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
  });
}

function notify(method: string, params: JsonObject): void {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

function structured(result: unknown): JsonObject {
  const value = result as { isError?: boolean; structuredContent?: JsonObject; content?: Array<{ type?: string; text?: string }> };
  if (value.isError) throw new Error('MCP_TOOL_ERROR');
  if (value.structuredContent && typeof value.structuredContent === 'object') return value.structuredContent;
  const text = value.content?.find((entry) => entry.type === 'text')?.text;
  if (text) {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as JsonObject;
  }
  throw new Error('MCP_STRUCTURED_RESULT_REQUIRED');
}

async function callTool(name: string, args: JsonObject): Promise<JsonObject> {
  return structured(await send('tools/call', { name, arguments: args }));
}

async function senderIds(): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query<{ sender_scoped_id: string }>(`
      SELECT DISTINCT sender_scoped_id
      FROM meta_webhook_events
      WHERE channel='DIRECT' AND NULLIF(BTRIM(sender_scoped_id), '') IS NOT NULL
      LIMIT 50
    `);
    await client.query('ROLLBACK');
    return result.rows.map((row) => row.sender_scoped_id).filter(Boolean);
  } finally { await client.end(); }
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}
function records(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asRecord).filter((v) => Object.keys(v).length > 0) : [];
}
function scalar(value: unknown): string { return typeof value === 'string' ? value : ''; }

async function main(): Promise<void> {
  await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'toca-os-instagram-message-index-probe', version: '1.0.0' } });
  notify('notifications/initialized', {});
  const ids = await senderIds();

  let conversationsFound = 0;
  let indexReadsSucceeded = 0;
  let indexedMessages = 0;
  let indexedMessages2025 = 0;
  let conversationsTouching2025 = 0;
  let indexesWithMore = 0;
  let oldestIndexedTime: string | null = null;
  let newestIndexedTime: string | null = null;

  for (const userId of ids) {
    try {
      const convoExec = await callTool('toca.execute', {
        capabilityId: 'instagram.messaging.conversations.read',
        payload: { limit: 1, userId },
        correlationId: `ig-index-convo-${Date.now()}`,
      });
      const conversations = records(asRecord(convoExec.result).conversations);
      conversationsFound += conversations.length;
      for (const conversation of conversations) {
        const conversationId = scalar(conversation.conversationId);
        if (!conversationId) continue;
        try {
          const indexExec = await callTool('toca.execute', {
            capabilityId: 'instagram.messaging.messages.read',
            payload: { conversationId, limit: 100, metadataOnly: true },
            correlationId: `ig-index-msg-${Date.now()}`,
          });
          indexReadsSucceeded += 1;
          const indexResult = asRecord(indexExec.result);
          const messages = records(indexResult.messages);
          indexedMessages += messages.length;
          if (indexResult.providerHasMore === true) indexesWithMore += 1;
          let touches2025 = false;
          for (const message of messages) {
            const created = scalar(message.createdTime);
            if (!created) continue;
            if (!oldestIndexedTime || created < oldestIndexedTime) oldestIndexedTime = created;
            if (!newestIndexedTime || created > newestIndexedTime) newestIndexedTime = created;
            if (created >= '2025-01-01' && created < '2026-01-01') {
              indexedMessages2025 += 1;
              touches2025 = true;
            }
          }
          if (touches2025) conversationsTouching2025 += 1;
        } catch { /* aggregate only */ }
      }
    } catch { /* aggregate only */ }
  }

  console.log(JSON.stringify({
    validation: 'instagram-dm-message-index-probe',
    senderIdsAvailable: ids.length,
    conversationsFound,
    indexReadsSucceeded,
    indexedMessages,
    indexedMessages2025,
    conversationsTouching2025,
    indexesWithMore,
    oldestIndexedTime,
    newestIndexedTime,
    providerErrors: [...providerErrors.entries()].map(([key, count]) => ({ ...JSON.parse(key), count })),
    metadataOnly: true,
    identitiesPrinted: false,
    messageTextPrinted: false,
    writesEnabled: false,
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ validation: 'instagram-dm-message-index-probe', status: 'FAILED', identitiesPrinted: false, messageTextPrinted: false, writesEnabled: false }));
  process.exitCode = 1;
}).finally(() => child.kill('SIGTERM'));
