import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadConfig } from './config.js';
import {
  mediaAssetSelectionRequestSchema,
  mediaAssetSelectionResultSchema,
} from './contracts/media-assets.js';
import { EnvironmentSecretResolver, type SecretResolver } from './core/secrets.js';
import { GoogleSheetsRestClient, type FetchLike } from './providers/google-sheets/client.js';
import { GoogleSheetsMediaAssetAdapter } from './providers/google-sheets/media-assets.js';
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

export interface TocaServerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly secretResolver?: SecretResolver;
  readonly fetcher?: FetchLike;
}

export function createTocaServer(options: TocaServerOptions = {}): McpServer {
  const config = loadConfig(options.env);
  const spreadsheetId = config.TOCA_OS_MEDIA_SPREADSHEET_ID;
  const tokenEnvKey = config.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY;
  const mediaAssetsRankEnabled = spreadsheetId !== undefined && tokenEnvKey !== undefined;

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    description: 'Execution tools for ChatGPT governed by TOCA_OS.',
  });
  const registry = createToolRegistry({ mediaAssetsRankEnabled });

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

  if (spreadsheetId !== undefined && tokenEnvKey !== undefined) {
    const runtimeOptions: MediaAssetsRankRuntimeOptions = {
      spreadsheetId,
      tokenEnvKey,
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.secretResolver !== undefined ? { secretResolver: options.secretResolver } : {}),
      ...(options.fetcher !== undefined ? { fetcher: options.fetcher } : {}),
    };
    registerMediaAssetsRankTool(server, runtimeOptions);
  }

  return server;
}

interface MediaAssetsRankRuntimeOptions {
  readonly spreadsheetId: string;
  readonly tokenEnvKey: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly secretResolver?: SecretResolver;
  readonly fetcher?: FetchLike;
}

function registerMediaAssetsRankTool(
  server: McpServer,
  options: MediaAssetsRankRuntimeOptions,
): void {
  const secrets = options.secretResolver ?? new EnvironmentSecretResolver(options.env);
  const clientOptions = {
    tokenReference: { provider: 'env', key: options.tokenEnvKey },
  } as const;
  const client = options.fetcher
    ? new GoogleSheetsRestClient(secrets, clientOptions, options.fetcher)
    : new GoogleSheetsRestClient(secrets, clientOptions);
  const adapter = new GoogleSheetsMediaAssetAdapter(client, {
    spreadsheetId: options.spreadsheetId,
  });

  server.registerTool(
    'media.assets.rank',
    {
      title: 'Rank TOCA media assets',
      description:
        'Rank selectable SUNSET media assets from TOCA_OS for a content item, format and optional theme.',
      inputSchema: mediaAssetSelectionRequestSchema,
      outputSchema: mediaAssetSelectionResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const output = await adapter.rank(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );
}
