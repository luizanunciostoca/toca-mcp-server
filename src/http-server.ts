import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { evaluateReadiness, type ReadinessCheck } from './health/readiness.js';
import type { InstagramWebhookEvent } from './providers/instagram/instagram-engagement-contracts.js';
import type { MetaManagedAsset } from './providers/meta/meta-assets.js';
import type { MetaTokenExchangeResult } from './providers/meta/meta-connection.js';
import type { MetaOAuthService } from './providers/meta/meta-oauth.js';
import {
  parseMetaWebhookEvents,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} from './providers/meta/meta-webhook.js';
import { createTocaServer, SERVER_NAME, SERVER_VERSION } from './server.js';

const MAX_META_WEBHOOK_BODY_BYTES = 1024 * 1024;

export interface MetaWebhookHttpBoundary {
  resolveVerifyToken(): Promise<string>;
  resolveAppSecret(): Promise<string>;
  onEvents?: (events: readonly InstagramWebhookEvent[]) => Promise<void> | void;
}

export interface TocaHttpServerOptions {
  readonly onError?: (error: unknown) => void;
  readonly readinessChecks?: readonly ReadinessCheck[];
  readonly metaOAuth?: MetaOAuthService;
  readonly metaAssetDiscovery?: (
    result: MetaTokenExchangeResult,
  ) => Promise<readonly MetaManagedAsset[]>;
  readonly metaWebhook?: MetaWebhookHttpBoundary;
  readonly mcpEnabled?: boolean;
}

export function createTocaHttpServer(options: TocaHttpServerOptions = {}): Server {
  const mcp = createMcpHandler(() => createTocaServer());
  const handleMcp = toNodeHandler(mcp, {
    onerror: (error) => {
      options.onError?.(error);
    },
  });

  return createServer((request, response) => {
    const requestUrl = request.url ?? '/';
    const method = request.method ?? 'POST';
    const url = new URL(requestUrl, `http://${request.headers.host ?? 'localhost'}`);

    if ((url.pathname === '/healthz' || url.pathname === '/health') && method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'ok', service: SERVER_NAME, version: SERVER_VERSION }));
      return;
    }

    if (url.pathname === '/readyz' && method === 'GET') {
      void evaluateReadiness(options.readinessChecks ?? []).then((report) => {
        response.writeHead(report.status === 'ready' ? 200 : 503, {
          'content-type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify(report));
      });
      return;
    }

    if (url.pathname === '/webhooks/meta' && method === 'GET' && options.metaWebhook) {
      void handleMetaWebhookChallenge(url, response, options).catch((error: unknown) => {
        options.onError?.(error);
        if (!response.headersSent) {
          response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        }
        if (!response.writableEnded) {
          response.end(JSON.stringify({ error: 'meta_webhook_verification_failed' }));
        }
      });
      return;
    }

    if (url.pathname === '/webhooks/meta' && method === 'POST' && options.metaWebhook) {
      void handleMetaWebhookEvent(request, response, options).catch((error: unknown) => {
        options.onError?.(error);
        if (!response.headersSent) {
          const status = error instanceof MetaWebhookBodyTooLargeError ? 413 : 400;
          response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        }
        if (!response.writableEnded) {
          response.end(JSON.stringify({ error: 'invalid_meta_webhook_event' }));
        }
      });
      return;
    }

    if (url.pathname === '/oauth/meta/start' && method === 'GET' && options.metaOAuth) {
      void options.metaOAuth
        .beginAuthorization()
        .then((authorization) => {
          response.writeHead(302, {
            location: authorization.authorizationUrl,
            'cache-control': 'no-store',
          });
          response.end();
        })
        .catch((error: unknown) => {
          options.onError?.(error);
          response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'meta_oauth_start_failed' }));
        });
      return;
    }

    if (url.pathname === '/oauth/meta/callback' && method === 'GET' && options.metaOAuth) {
      const providerError = url.searchParams.get('error');
      if (providerError) {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'meta_oauth_denied', providerError }));
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'invalid_meta_oauth_callback' }));
        return;
      }

      void options.metaOAuth
        .completeAuthorization({ code, state })
        .then(async (result) => {
          const assets = options.metaAssetDiscovery
            ? await options.metaAssetDiscovery(result)
            : undefined;
          response.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          response.end(
            JSON.stringify({
              status: 'connected',
              grantedScopes: result.grantedScopes,
              ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
              ...(assets ? { assets } : {}),
            }),
          );
        })
        .catch((error: unknown) => {
          options.onError?.(error);
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'meta_oauth_callback_failed' }));
        });
      return;
    }

    if (url.pathname !== '/mcp' || options.mcpEnabled === false) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    const normalizedRequest: NodeIncomingMessageLike = {
      method,
      url: requestUrl,
      headers: request.headers,
      [Symbol.asyncIterator]: () => request[Symbol.asyncIterator](),
    };

    void handleMcp(normalizedRequest, response).catch((error: unknown) => {
      options.onError?.(error);
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      }
      if (!response.writableEnded) {
        response.end(JSON.stringify({ error: 'mcp_request_failed' }));
      }
    });
  });
}

async function handleMetaWebhookChallenge(
  url: URL,
  response: ServerResponse,
  options: TocaHttpServerOptions,
): Promise<void> {
  const expectedVerifyToken = await options.metaWebhook!.resolveVerifyToken();
  const result = verifyMetaWebhookChallenge(
    {
      mode: url.searchParams.get('hub.mode'),
      verifyToken: url.searchParams.get('hub.verify_token'),
      challenge: url.searchParams.get('hub.challenge'),
    },
    expectedVerifyToken,
  );

  if (!result.accepted || !result.challenge) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'meta_webhook_verification_rejected' }));
    return;
  }

  response.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(result.challenge);
}

async function handleMetaWebhookEvent(
  request: IncomingMessage,
  response: ServerResponse,
  options: TocaHttpServerOptions,
): Promise<void> {
  const rawBody = await readRequestBody(request, MAX_META_WEBHOOK_BODY_BYTES);
  const signature = headerValue(request.headers['x-hub-signature-256']);
  const appSecret = await options.metaWebhook!.resolveAppSecret();

  if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
    response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'invalid_meta_webhook_signature' }));
    return;
  }

  const events = parseMetaWebhookEvents(rawBody);
  await options.metaWebhook!.onEvents?.(events);

  response.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end('EVENT_RECEIVED');
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) throw new MetaWebhookBodyTooLargeError();
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, totalBytes);
}

function headerValue(value: string | readonly string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

class MetaWebhookBodyTooLargeError extends Error {
  constructor() {
    super('Meta webhook request body is too large');
  }
}
