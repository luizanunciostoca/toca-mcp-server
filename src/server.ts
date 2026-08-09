import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { createToolRegistry } from './registry.js';

export const SERVER_NAME = 'toca-mcp-server';
export const SERVER_VERSION = '0.1.0';

const capabilityStatusSchema = z.enum([
  'PLANNED',
  'IMPLEMENTED',
  'CONNECTED',
  'PRODUCTION_VALIDATED',
  'SUSPENDED',
  'DEPRECATED',
  'REMOVED',
]);

const riskClassSchema = z.enum([
  'READ',
  'WRITE_REVERSIBLE',
  'WRITE_EXTERNAL',
  'FINANCIAL_IMPACT',
  'DESTRUCTIVE',
]);

export function createTocaServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    description: 'Execution tools for ChatGPT governed by TOCA_OS.',
  });
  const registry = createToolRegistry();

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
    () => {
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

  server.registerTool(
    'system.capabilities',
    {
      title: 'TOCA MCP Capabilities',
      description:
        'List tools registered in this runtime and their implementation status. This does not imply external provider connectivity.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        tools: z.array(
          z.object({
            name: z.string(),
            version: z.string(),
            provider: z.string(),
            riskClass: riskClassSchema,
            requiredScopes: z.array(z.string()),
            capabilityStatus: capabilityStatusSchema,
            sideEffects: z.boolean(),
            idempotent: z.boolean(),
          }),
        ),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () => {
      const output = {
        tools: registry.list().map((tool) => ({
          ...tool,
          requiredScopes: [...tool.requiredScopes],
        })),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  return server;
}
