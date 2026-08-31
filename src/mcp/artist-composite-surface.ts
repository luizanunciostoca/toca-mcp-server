import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { artistAssetSchema } from '../contracts/artist-integrity.js';
import { LocalMultiLayerCreativeComposer } from '../providers/local/local-multilayer-creative-composer.js';

export const ARTIST_COMPOSITE_MCP_TOOL_NAME = 'toca.creative.artist_composite';

const imageContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const canvasSchema = z.enum(['1080x1350', '1080x1920', '1080x1080']);
const fadeDirectionSchema = z.enum([
  'LEFT_TO_RIGHT',
  'RIGHT_TO_LEFT',
  'TOP_TO_BOTTOM',
  'BOTTOM_TO_TOP',
]);

const artistCompositeInputSchema = z.object({
  artistAsset: artistAssetSchema,
  artistBase64: z.string().min(1).max(40_000_000),
  artistContentType: imageContentTypeSchema,
  venueBase64: z.string().min(1).max(40_000_000),
  venueContentType: imageContentTypeSchema,
  venueAssetId: z.string().min(1),
  venueDriveFileId: z.string().min(1),
  protectionMaskBase64: z.string().min(1).max(40_000_000),
  maskContentType: imageContentTypeSchema,
  maskForArtistSourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  canvas: canvasSchema.default('1080x1350'),
  venueOpacityPercent: z.number().min(0).max(100).default(55),
  orangeTint: z
    .string()
    .regex(/^#[a-f0-9]{6}$/i)
    .default('#d96b16'),
  fadeDirection: fadeDirectionSchema.default('RIGHT_TO_LEFT'),
});

export function registerArtistCompositeSurface(
  server: McpServer,
  composer = new LocalMultiLayerCreativeComposer(),
): void {
  server.registerTool(
    ARTIST_COMPOSITE_MCP_TOOL_NAME,
    {
      title: 'Artist-Safe Deterministic Composite',
      description:
        'Compose approved real artist and venue images without generative synthesis. The artist source and protection-mask lineage are fail-closed SHA-256 verified.',
      inputSchema: artistCompositeInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const parsed = artistCompositeInputSchema.parse(input);
      const result = await composer.compose({
        artist: {
          assetId: parsed.artistAsset.sourceAssetId,
          driveFileId: parsed.artistAsset.sourceDriveFileId,
          bytes: decodeBase64(parsed.artistBase64, 'ARTIST_BASE64_INVALID'),
          contentType: parsed.artistContentType,
          registry: parsed.artistAsset,
        },
        venue: {
          assetId: parsed.venueAssetId,
          driveFileId: parsed.venueDriveFileId,
          bytes: decodeBase64(parsed.venueBase64, 'VENUE_BASE64_INVALID'),
          contentType: parsed.venueContentType,
        },
        artistProtectionMaskBytes: decodeBase64(
          parsed.protectionMaskBase64,
          'ARTIST_PROTECTION_MASK_BASE64_INVALID',
        ),
        maskContentType: parsed.maskContentType,
        maskForArtistSourceSha256: parsed.maskForArtistSourceSha256,
        canvas: parsed.canvas,
        venueOpacityPercent: parsed.venueOpacityPercent,
        orangeTint: parsed.orangeTint,
        fadeDirection: parsed.fadeDirection,
      });

      const payload = {
        outputContentType: result.outputContentType,
        outputBase64: Buffer.from(result.outputBytes).toString('base64'),
        outputSha256: result.outputSha256,
        artistSourceSha256: result.artistSourceSha256,
        venueSourceSha256: result.venueSourceSha256,
        protectionMaskSha256: result.protectionMaskSha256,
        maskForArtistSourceSha256: result.maskForArtistSourceSha256,
        artistIntegrity: result.artistIntegrity,
        provider: result.provider,
        pipelineVersion: result.pipelineVersion,
        creativeMode: result.creativeMode,
        nonGenerative: result.nonGenerative,
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
  if (
    !normalized ||
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error(code);
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.byteLength === 0) throw new Error(code);
  return bytes;
}
