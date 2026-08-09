import { createServer } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createTocaServer, SERVER_NAME, SERVER_VERSION } from './server.js';

const host = process.env.MCP_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.MCP_PORT ?? '3000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('MCP_PORT must be an integer between 1 and 65535');
}

const mcp = createMcpHandler(() => createTocaServer());
const handleMcp = toNodeHandler(mcp, {
  onerror: (error) => {
    console.error('MCP request failed', error instanceof Error ? error.message : 'unknown error');
  },
});

const server = createServer((request, response) => {
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

  void handleMcp(request, response).catch(() => {
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    }
    if (!response.writableEnded) {
      response.end(JSON.stringify({ error: 'mcp_request_failed' }));
    }
  });
});

server.listen(port, host, () => {
  console.log(`${SERVER_NAME} remote MCP listening on http://${host}:${port}/mcp`);
});
