import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createArtistSafeTocaServer } from './artist-safe-server.js';

serveStdio(() => createArtistSafeTocaServer());
