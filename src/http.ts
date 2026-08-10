import { loadConfig } from './config.js';
import { createTocaHttpServer } from './http-server.js';
import { createMetaHttpRuntime } from './providers/meta/meta-http-runtime.js';
import { SERVER_NAME } from './server.js';

const config = loadConfig();
const metaRuntime = createMetaHttpRuntime(config, process.env);
const host =
  process.env.MCP_HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const port = Number.parseInt(process.env.MCP_PORT ?? process.env.PORT ?? '3000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('MCP_PORT/PORT must be an integer between 1 and 65535');
}

const server = createTocaHttpServer({
  onError: (error) => {
    console.error('MCP request failed', error instanceof Error ? error.message : 'unknown error');
  },
  mcpEnabled: config.MCP_ENABLED,
  ...(metaRuntime
    ? {
        metaOAuth: metaRuntime.oauth,
        metaAssetDiscovery: (result) => metaRuntime.discoverAssets(result),
      }
    : {}),
});

server.listen(port, host, () => {
  console.log(`${SERVER_NAME} HTTP runtime listening on http://${host}:${port}`);
});
