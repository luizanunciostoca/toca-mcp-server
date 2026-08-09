import { createServer, type Server } from 'node:http';
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { evaluateReadiness, type ReadinessCheck } from './health/readiness.js';
import { createTocaServer, SERVER_NAME, SERVER_VERSION } from './server.js';

export interface TocaHttpServerOptions {
  readonly onError?: (error: unknown) => void;
  readonly readinessChecks?: readonly ReadinessCheck[];
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

    if (url.pathname === '/healthz' && method === 'GET') {
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

    if (url.pathname !== '/mcp') {
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
