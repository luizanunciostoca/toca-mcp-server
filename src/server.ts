import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

export const SERVER_NAME = 'toca-mcp-server';
export const SERVER_VERSION = '0.1.0';

export function createTocaServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    description: 'Execution tools for ChatGPT governed by TOCA_OS.',
  });

  server.registerTool(
    'system.health',
    {
      title: 'TOCA MCP Health',
      description: 'Return the health and bootstrap state of the TOCA MCP server.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        status: z.literal('ok'),
        service: z.string(),
        version: z.string(),
        phase: z.literal('bootstrap'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const output = {
        status: 'ok' as const,
        service: SERVER_NAME,
        version: SERVER_VERSION,
        phase: 'bootstrap' as const,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  return server;
}
