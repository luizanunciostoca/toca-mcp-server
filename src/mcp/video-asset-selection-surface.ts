import type { McpServer } from '@modelcontextprotocol/server';
import {
  videoAssetSelectionRequestSchema,
  videoAssetUsageRecordSchema,
} from '../contracts/video-asset-selection.js';
import type { ToolDefinition } from '../core/tool-registry.js';
import {
  createLazyVideoAssetSelectionRuntimeResolver,
  type VideoAssetSelectionRuntimeResolver,
} from './video-asset-selection-runtime.js';

export const VIDEO_SELECT_ASSETS_TOOL = 'video.select_assets';
export const VIDEO_RECORD_ASSET_USAGE_TOOL = 'video.record_asset_usage';

export const VIDEO_ASSET_SELECTION_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: VIDEO_SELECT_ASSETS_TOOL,
    version: '1.0.0',
    provider: 'TOCA_OS Creative Truth intelligent selector',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: false,
  },
  {
    name: VIDEO_RECORD_ASSET_USAGE_TOOL,
    version: '1.0.0',
    provider: 'TOCA_OS Creative Truth usage ledger',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: true,
  },
];

export function registerVideoAssetSelectionSurface(
  server: McpServer,
  resolveRuntime: VideoAssetSelectionRuntimeResolver =
    createLazyVideoAssetSelectionRuntimeResolver(),
): void {
  server.registerTool(
    VIDEO_SELECT_ASSETS_TOOL,
    {
      title: 'Select Governed Video Assets',
      description:
        'Resolve a Reel/video brief into required story functions and rank only already-promoted VIDEO_SHOTS. Applies discoverable, creative-eligibility, marketing-rights, venue, source-type, quality, freshness and anti-repeat gates before scoring. Returns exact Google Drive File IDs only; it never scans or downloads an entire source-library folder and never promotes VIDEO_SOURCE_INTAKE records by inference. Missing required story functions return VIDEO_COVERAGE_GAP. Selection does not authorize publication.',
      inputSchema: videoAssetSelectionRequestSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const parsed = videoAssetSelectionRequestSchema.parse(input);
      const result = await resolveRuntime().selector.select(parsed);
      return toolPayload(result);
    },
  );

  server.registerTool(
    VIDEO_RECORD_ASSET_USAGE_TOOL,
    {
      title: 'Record Governed Video Asset Usage',
      description:
        'Record that one exact promoted VIDEO_SHOT was used in an output. Appends the canonical VIDEO_USAGE_LOG and atomically updates usage_count, last_used_at, last output/reel/campaign and usage purpose on VIDEO_SHOTS. The usageId is idempotent and cannot be rebound to different bytes/output identity.',
      inputSchema: videoAssetUsageRecordSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const parsed = videoAssetUsageRecordSchema.parse(input);
      const result = await resolveRuntime().selector.recordUsage(parsed);
      return toolPayload({ ...result, publicationAuthorized: false as const });
    },
  );
}

function toolPayload<T extends Record<string, unknown>>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}
