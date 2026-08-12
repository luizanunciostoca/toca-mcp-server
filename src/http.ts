import { createTocaHttpServer } from './http-server.js';
import { SERVER_NAME } from './server.js';

const host = process.env.MCP_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.MCP_PORT ?? '3000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('MCP_PORT must be an integer between 1 and 65535');
}

const server = createTocaHttpServer({
  onError: (error) => {
    console.error('MCP request failed', error instanceof Error ? error.message : 'unknown error');
  },
});

server.listen(port, host, () => {
  console.log(`${SERVER_NAME} remote MCP listening on http://${host}:${port}/mcp`);
});
