import type { McpServer } from '@modelcontextprotocol/server';
import { registerArtistCompositeSurface } from './mcp/artist-composite-surface.js';
import { registerArtistSegmentSurface } from './mcp/artist-segment-surface.js';
import { createTocaServer, type TocaServerOptions } from './server.js';

export { SERVER_NAME, SERVER_VERSION } from './server.js';

export function createArtistSafeTocaServer(options: TocaServerOptions = {}): McpServer {
  const server = createTocaServer(options);
  registerArtistSegmentSurface(server);
  registerArtistCompositeSurface(server);
  return server;
}
