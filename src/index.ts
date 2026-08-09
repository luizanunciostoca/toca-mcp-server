import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createTocaServer } from './server.js';

await serveStdio(() => createTocaServer());
