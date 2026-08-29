import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

type JsonObject = Record<string, unknown>;
type RpcReply = {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

const graphBase = (process.env.META_GRAPH_BASE_URL ?? 'https://graph.facebook.com').replace(/\/$/, '');
const graphVersion = process.env.META_GRAPH_API_VERSION ?? 'v24.0';
const instagramAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim();
const accessToken = process.env.META_ACCESS_TOKEN?.trim();

if (!instagramAccountId) throw new Error('INSTAGRAM_BUSINESS_ACCOUNT_ID_REQUIRED');
if (!accessToken) throw new Error('META_ACCESS_TOKEN_REQUIRED');

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
    // Never echo raw server stderr in this diagnostic.
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

async function graphGet(path: string, query: Record<string, string>): Promise<JsonObject> {
  const url = new URL(`${graphBase}/${graphVersion}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const root = asRecord(body);
    const error = asRecord(root.error);
    throw new Error(
      `GRAPH_READ_FAILED:${response.status}:${integer(error.code) ?? 'NA'}:${integer(error.error_subcode) ?? 'NA'}`,
    );
  }
  return asRecord(body);
}

async function candidateInstagramScopedIds(): Promise<{ mediaCount: number; ids: string[] }> {
  const media = await graphGet(`${instagramAccountId}/media`, {
    fields: 'id,timestamp',
    since: '2025-01-01T00:00:00+0000',
    until: '2025-12-31T23:59:59+0000',
    limit: '50',
  });
  const mediaRows = arrayOfRecords(media.data).slice(0, 25);
  const ids = new Set<string>();
  for (const row of mediaRows) {
    const mediaId = scalar(row.id);
    if (!mediaId) continue;
    try {
      const comments = await graphGet(`${mediaId}/comments`, {
        fields: 'from',
        limit: '100',
      });
      for (const comment of arrayOfRecords(comments.data)) {
        const from = asRecord(comment.from);
        const id = scalar(from.id);
        if (id && id !== instagramAccountId) ids.add(id);
        if (ids.size >= 40) break;
      }
    } catch {
      // Continue with other media; aggregate diagnostics only.
    }
    if (ids.size >= 40) break;
  }
  return { mediaCount: mediaRows.length, ids: [...ids] };
}

async function main(): Promise<void> {
  const initialized = (await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'toca-os-instagram-bounded-user-probe', version: '1.0.0' },
  })) as { serverInfo?: { name?: string }; protocolVersion?: string };
  notify('notifications/initialized', {});

  const candidates = await candidateInstagramScopedIds();
  const bounded = candidates.ids.slice(0, 20);
  let probesAttempted = 0;
  let successfulCalls = 0;
  let conversationsFound = 0;
  let messageReadsSucceeded = 0;
  let messagesReturned = 0;
  let inboundMessages = 0;
  let inboundMessages2025 = 0;
  let conversationsWithProviderHasMore = 0;

  for (const userId of bounded) {
    probesAttempted += 1;
    try {
      const execution = await callTool('toca.execute', {
        capabilityId: 'instagram.messaging.conversations.read',
        payload: { limit: 1, userId },
        correlationId: `instagram-dm-bounded-${Date.now()}-${probesAttempted}`,
      });
      successfulCalls += 1;
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
            correlationId: `instagram-dm-bounded-messages-${Date.now()}-${probesAttempted}`,
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
            }
          }
        } catch {
          // Keep probing other conversations. No message content is logged.
        }
      }
    } catch {
      // Aggregate only; never print userId or raw error.
    }
  }

  console.log(
    JSON.stringify({
      validation: 'instagram-dm-bounded-user-probe',
      mcpServer: initialized.serverInfo?.name ?? null,
      protocolVersion: initialized.protocolVersion ?? null,
      mediaFrom2025Inspected: candidates.mediaCount,
      candidateInstagramScopedIds: candidates.ids.length,
      probesAttempted,
      successfulConversationCalls: successfulCalls,
      conversationsFound,
      messageReadsSucceeded,
      messagesReturned,
      inboundMessages,
      inboundMessages2025,
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

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

main()
  .catch((error) => {
    const code = error instanceof Error ? error.message.replace(/[^A-Z0-9:_-]/gi, '_').slice(0, 160) : 'UNKNOWN';
    console.log(
      JSON.stringify({
        validation: 'instagram-dm-bounded-user-probe',
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
