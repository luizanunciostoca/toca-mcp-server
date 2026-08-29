import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import pg from 'pg';

type JsonObject = Record<string, unknown>;
type RpcReply = { jsonrpc: '2.0'; id?: number; result?: unknown; error?: { code?: number } };

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
  let reply: RpcReply;
  try {
    reply = JSON.parse(line.trim()) as RpcReply;
  } catch {
    return;
  }
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
  } catch {
    // Never print raw stderr.
  }
});

function send(method: string, params: JsonObject): Promise<unknown> {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('MCP_TIMEOUT'));
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

async function directSenderIds(): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query<{ sender_scoped_id: string }>(`
      SELECT DISTINCT sender_scoped_id
      FROM meta_webhook_events
      WHERE channel = 'DIRECT'
        AND NULLIF(BTRIM(sender_scoped_id), '') IS NOT NULL
      LIMIT 50
    `);
    await client.query('ROLLBACK');
    return result.rows.map((row) => row.sender_scoped_id).filter(Boolean);
  } finally {
    await client.end();
  }
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}
function records(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asRecord).filter((v) => Object.keys(v).length > 0) : [];
}
function scalar(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function main(): Promise<void> {
  await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'toca-os-instagram-2025-detail-probe', version: '1.0.0' },
  });
  notify('notifications/initialized', {});

  const senderIds = await directSenderIds();
  const messageIds2025 = new Set<string>();
  let conversationLookupsSucceeded = 0;
  let conversationsFound = 0;
  let metadataReadsSucceeded = 0;
  let indexedMessages2025 = 0;
  let detailAttempts2025 = 0;
  let detailSuccesses2025 = 0;
  let textDetailSuccesses2025 = 0;
  let inboundDetailSuccesses2025 = 0;
  let outboundDetailSuccesses2025 = 0;
  let unknownDirectionDetailSuccesses2025 = 0;

  for (const userId of senderIds) {
    try {
      const conversationExec = await callTool('toca.execute', {
        capabilityId: 'instagram.messaging.conversations.read',
        payload: { limit: 1, userId },
        correlationId: `ig-2025-detail-convo-${Date.now()}`,
      });
      conversationLookupsSucceeded += 1;
      const conversations = records(asRecord(conversationExec.result).conversations);
      conversationsFound += conversations.length;
      for (const conversation of conversations) {
        const conversationId = scalar(conversation.conversationId);
        if (!conversationId) continue;
        try {
          const metadataExec = await callTool('toca.execute', {
            capabilityId: 'instagram.messaging.messages.read',
            payload: { conversationId, limit: 100, metadataOnly: true },
            correlationId: `ig-2025-detail-index-${Date.now()}`,
          });
          metadataReadsSucceeded += 1;
          const messages = records(asRecord(metadataExec.result).messages);
          for (const message of messages) {
            const createdTime = scalar(message.createdTime);
            const messageId = scalar(message.messageId);
            if (
              messageId &&
              createdTime >= '2025-01-01' &&
              createdTime < '2026-01-01'
            ) {
              messageIds2025.add(messageId);
            }
          }
        } catch {
          // Aggregate only.
        }
      }
    } catch {
      // Aggregate only.
    }
  }

  indexedMessages2025 = messageIds2025.size;
  for (const messageId of messageIds2025) {
    detailAttempts2025 += 1;
    try {
      const detailExec = await callTool('toca.execute', {
        capabilityId: 'instagram.messaging.messages.read',
        payload: { messageId, detailOnly: true },
        correlationId: `ig-2025-detail-message-${Date.now()}-${detailAttempts2025}`,
      });
      const messages = records(asRecord(detailExec.result).messages);
      if (messages.length === 0) continue;
      detailSuccesses2025 += 1;
      const message = messages[0] ?? {};
      if (scalar(message.text).trim()) textDetailSuccesses2025 += 1;
      if (message.direction === 'INBOUND') inboundDetailSuccesses2025 += 1;
      else if (message.direction === 'OUTBOUND') outboundDetailSuccesses2025 += 1;
      else unknownDirectionDetailSuccesses2025 += 1;
    } catch {
      // Provider errors are captured separately, with no message identifiers.
    }
  }

  console.log(
    JSON.stringify({
      validation: 'instagram-dm-2025-detail-probe',
      senderIdsAvailable: senderIds.length,
      conversationLookupsSucceeded,
      conversationsFound,
      metadataReadsSucceeded,
      indexedMessages2025,
      detailAttempts2025,
      detailSuccesses2025,
      textDetailSuccesses2025,
      inboundDetailSuccesses2025,
      outboundDetailSuccesses2025,
      unknownDirectionDetailSuccesses2025,
      providerErrors: [...providerErrors.entries()].map(([key, count]) => ({ ...JSON.parse(key), count })),
      messageIdsPrinted: false,
      identitiesPrinted: false,
      messageTextPrinted: false,
      writesEnabled: false,
    }),
  );
}

main()
  .catch(() => {
    console.log(
      JSON.stringify({
        validation: 'instagram-dm-2025-detail-probe',
        status: 'FAILED',
        messageIdsPrinted: false,
        identitiesPrinted: false,
        messageTextPrinted: false,
        writesEnabled: false,
      }),
    );
    process.exitCode = 1;
  })
  .finally(() => child.kill('SIGTERM'));
