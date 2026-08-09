import { createServer, type Server } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createTocaServer, SERVER_NAME, SERVER_VERSION } from './server.js';

export interface TocaHttpServerOptions {
  readonly onError?: (error: unknown) => void;
}

export function createTocaHttpServer(options: TocaHttpServerOptions = {}): Server {
  const mcp = createMcpHandler(() => createTocaServer());
  const handleMcp = toNodeHandler(mcp, {
    onerror: (error) => {
      options.onError?.(error);
    },
  });

  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname === '/healthz' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'ok', service: SERVER_NAME, version: SERVER_VERSION }));
      return;
    }

    if (url.pathname !== '/mcp') {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    void handleMcp(request, response).catch((error: unknown) => {
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
