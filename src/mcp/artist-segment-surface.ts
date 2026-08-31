import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { artistAssetSchema } from '../contracts/artist-integrity.js';
import { ArtistSegmentationService } from '../creative/artist-segmentation.js';
import { LocalRembgSegmentationProvider } from '../providers/segmentation/local-rembg-segmentation-provider.js';

export const ARTIST_SEGMENT_MCP_TOOL_NAME = 'toca.creative.artist_segment';

const contentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);

const artistSegmentInputSchema = z.object({
  artistAsset: artistAssetSchema,
  artistBase64: z.string().min(1).max(40_000_000),
  artistContentType: contentTypeSchema,
});

export function registerArtistSegmentSurface(
  server: McpServer,
  service = new ArtistSegmentationService(new LocalRembgSegmentationProvider()),
): void {
  server.registerTool(
    ARTIST_SEGMENT_MCP_TOOL_NAME,
    {
      title: 'Artist-Safe Local Subject Segmentation',
      description:
        'Create a protection mask and transparent artist cutout using local non-generative segmentation. Segmentation RGB is discarded; the cutout is recomposed exclusively from the approved original artist source pixels.',
      inputSchema: artistSegmentInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const parsed = artistSegmentInputSchema.parse(input);
      const result = await service.segment({
        artistAsset: parsed.artistAsset,
        sourceBytes: decodeBase64(parsed.artistBase64, 'ARTIST_BASE64_INVALID'),
        sourceContentType: parsed.artistContentType,
      });

      const payload = {
        artistCutoutContentType: 'image/png' as const,
        artistCutoutBase64: Buffer.from(result.artistCutoutPngBytes).toString('base64'),
        protectionMaskContentType: 'image/png' as const,
        protectionMaskBase64: Buffer.from(result.protectionMaskPngBytes).toString('base64'),
        artistSourceSha256: result.artistSourceSha256,
        artistCutoutSha256: result.artistCutoutSha256,
        protectionMaskSha256: result.protectionMaskSha256,
        maskForArtistSourceSha256: result.artistSourceSha256,
        provider: result.provider,
        nonGenerative: result.nonGenerative,
        pixelSourcePreserved: result.pixelSourcePreserved,
        pipelineVersion: result.pipelineVersion,
        artistIntegrity: result.artistIntegrity,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );
}

function decodeBase64(value: string, code: string): Uint8Array {
  const normalized = value.trim();
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error(code);
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.byteLength === 0) throw new Error(code);
  return bytes;
}
