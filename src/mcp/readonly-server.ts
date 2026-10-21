import { MCP_MAX_TOOL_INPUT_ELEMENTS } from './security-limits.js';
import { McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';
import { ToolRegistry } from '../core/tool-registry.js';
import { registerTocaCoreSurface } from './core-surface.js';
import type { ReadonlyMcpAuth } from './readonly-auth.js';

type ReadResult = {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
};

export const READONLY_MCP_TOOL_NAMES = [
  'toca.system.health',
  'toca.capabilities.search',
  'toca.capabilities.describe',
] as const;

export function createReadonlyMcpServer(
  auth: ReadonlyMcpAuth,
  authInfo: AuthInfo | undefined,
): McpServer {
  auth.resolveIdentity(authInfo);
  const server = new McpServer(
    { name: 'toca-mcp-readonly', version: '0.2.0' },
    { maxToolInputElements: MCP_MAX_TOOL_INPUT_ELEMENTS },
  );
  // Forward canonical registrations before they reach the SDK. Unlisted handlers never register.
  // This avoids copying the Core catalog, schemas, or search/describe implementations.
  const registration = {
    registerTool(
      name: string,
      definition: {
        title: string;
        description: string;
        inputSchema: z.ZodType;
        annotations: { readOnlyHint: boolean };
      },
      callback: (...args: unknown[]) => ReadResult | Promise<ReadResult>,
    ) {
      if (!(READONLY_MCP_TOOL_NAMES as readonly string[]).includes(name)) return;
      server.registerTool(name, definition, async (...args: unknown[]): Promise<ReadResult> => {
        auth.resolveIdentity(authInfo);
        const result = await callback(...args);
        if (name !== 'toca.system.health') return result;
        const output = {
          ...result.structuredContent,
          toolCount: READONLY_MCP_TOOL_NAMES.length,
          discoveryOnly: true,
        };
        return {
          ...result,
          structuredContent: output,
          content: [{ type: 'text', text: JSON.stringify(output) }],
        };
      });
    },
  } as unknown as McpServer;
  registerTocaCoreSurface(registration, {
    serviceName: 'toca-mcp-readonly',
    serviceVersion: '0.2.0',
    registry: new ToolRegistry(),
    runtimeResolver: () => undefined,
    resolveIdentity: () => auth.resolveIdentity(authInfo),
  });
  return server;
}
