import type { McpServer } from '@modelcontextprotocol/server';
import { registerArtistCompositeSurface } from './mcp/artist-composite-surface.js';
import { registerArtistSegmentSurface } from './mcp/artist-segment-surface.js';
import {
  registerVideoAssetSelectionSurface,
  VIDEO_ASSET_SELECTION_TOOL_DEFINITIONS,
} from './mcp/video-asset-selection-surface.js';
import {
  registerVideoGenerativeSurface,
  VIDEO_GENERATIVE_TOOL_DEFINITIONS,
} from './mcp/video-generative-surface.js';
import { createTocaServer, type TocaServerOptions } from './server.js';

export { SERVER_NAME, SERVER_VERSION } from './server.js';

export function createArtistSafeTocaServer(options: TocaServerOptions = {}): McpServer {
  const server = createTocaServer({
    ...options,
    onRuntimeComposition: (composition) => {
      for (const tool of VIDEO_GENERATIVE_TOOL_DEFINITIONS) composition.registry.register(tool);
      for (const tool of VIDEO_ASSET_SELECTION_TOOL_DEFINITIONS) composition.registry.register(tool);
      options.onRuntimeComposition?.(composition);
    },
  });
  registerArtistSegmentSurface(server);
  registerArtistCompositeSurface(server);
  registerVideoAssetSelectionSurface(server);
  registerVideoGenerativeSurface(server);
  return server;
}
