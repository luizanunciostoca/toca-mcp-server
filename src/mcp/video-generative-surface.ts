import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  photoToVideoCandidateManifestSchema,
  photoToVideoReviewEvidenceSchema,
} from '../contracts/photo-to-video.js';
import type { ToolDefinition } from '../core/tool-registry.js';
import {
  createLazyVideoGenerativeRuntimeResolver,
  type VideoGenerativeRuntimeResolver,
} from './video-generative-runtime.js';

export const VIDEO_GENERATE_SCENE_CONTINUATION_TOOL = 'video.generate_scene_continuation';
export const VIDEO_FINALIZE_SCENE_CONTINUATION_TOOL = 'video.finalize_scene_continuation';
export const VIDEO_OVERLAY_STATIC_GRAPHICS_TOOL = 'video.postprocess.overlay_static_graphics';
export const VIDEO_TRIM_TOOL = 'video.postprocess.trim';

export const VIDEO_GENERATIVE_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: VIDEO_GENERATE_SCENE_CONTINUATION_TOOL,
    version: '1.1.0',
    provider: 'TOCA_OS governed video provider plan',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: false,
  },
  {
    name: VIDEO_FINALIZE_SCENE_CONTINUATION_TOOL,
    version: '1.0.0',
    provider: 'TOCA_OS',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: true,
  },
  {
    name: VIDEO_OVERLAY_STATIC_GRAPHICS_TOOL,
    version: '1.0.0',
    provider: 'LOCAL_FFMPEG',
    riskClass: 'READ',
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: VIDEO_TRIM_TOOL,
    version: '1.0.0',
    provider: 'LOCAL_FFMPEG',
    riskClass: 'READ',
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
];

const videoBase64Schema = z.string().trim().min(16).max(120_000_000);
const generateInputSchema = z.object({
  contentItemId: z.string().trim().min(1).max(256),
  creativeDirection: z.string().trim().min(1).max(16_000),
  returnBase64: z.boolean().default(false),
});
const finalizeInputSchema = z.object({
  candidateManifest: photoToVideoCandidateManifestSchema,
  reviewEvidence: photoToVideoReviewEvidenceSchema,
});
const overlayInputSchema = z.object({
  videoBase64: videoBase64Schema,
  overlayPngBase64: z.string().trim().min(16).max(80_000_000),
});
const trimInputSchema = z.object({
  videoBase64: videoBase64Schema,
  startSeconds: z.number().min(0).max(600).default(0),
  durationSeconds: z.number().positive().max(600),
});

export function registerVideoGenerativeSurface(
  server: McpServer,
  resolveRuntime: VideoGenerativeRuntimeResolver = createLazyVideoGenerativeRuntimeResolver(),
): void {
  server.registerTool(
    VIDEO_GENERATE_SCENE_CONTINUATION_TOOL,
    {
      title: 'Generate Governed Scene-Continuation Video',
      description:
        'Generate an image-to-video continuation from the exact canonical TOCA_OS source bound to a CONTENT_ITEM. Requires cleared VIDEO_SOURCE_RIGHTS and an APPROVED VIDEO_GENERATIVE_EXCEPTIONS row. Uses the configured governed provider plan (canonical primary Vertex Veo, optional OpenAI Video fallback when configured). Fallback is permitted only for retryable provider availability/rate-limit failures and never bypasses policy, approval, rights, source binding, fidelity or technical gates. Persists the exact candidate artifact before returning GENERATED_REVIEW_REQUIRED.',
      inputSchema: generateInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const parsed = generateInputSchema.parse(input);
      const result = await resolveRuntime().generation.generate({
        contentItemId: parsed.contentItemId,
        routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
        creativeDirection: parsed.creativeDirection,
      });
      const payload = {
        status: result.manifest.status,
        manifest: result.manifest,
        outputContentType: 'video/mp4' as const,
        outputSha256: result.manifest.outputSha256,
        artifactRef: result.manifest.artifactRef,
        provider: result.manifest.provider,
        providerJobId: result.manifest.providerJobId ?? null,
        providerModel: result.manifest.providerModel ?? null,
        providerAttemptChain: result.manifest.providerAttemptChain ?? [result.manifest.provider],
        providerFallbackUsed: result.manifest.providerFallbackUsed ?? false,
        requiresPostGenerationHumanReview: true as const,
        publicationEligible: false as const,
        ...(parsed.returnBase64
          ? { outputBase64: Buffer.from(result.outputBytes).toString('base64') }
          : {}),
      };
      return toolPayload(payload);
    },
  );

  server.registerTool(
    VIDEO_FINALIZE_SCENE_CONTINUATION_TOOL,
    {
      title: 'Finalize Governed Scene-Continuation Video',
      description:
        'Finalize the exact generated candidate only after human or multimodal-plus-human QA evidence passes Venue Fidelity, Brand Integrity, Quality and Scene Continuation Fidelity. Re-resolves canonical policy, source, brand, approval and artifact bytes before writing final evidence.',
      inputSchema: finalizeInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const parsed = finalizeInputSchema.parse(input);
      const finalManifest = await resolveRuntime().finalization.finalize(parsed);
      const payload = {
        status: finalManifest.status,
        finalManifest,
        finalAssetSha256: finalManifest.finalAssetSha256,
        finalArtifactRef: finalManifest.finalArtifactRef,
        readyForPrepare: finalManifest.readyForPrepare,
        publicationAuthorized: finalManifest.publicationAuthorized,
      };
      return toolPayload(payload);
    },
  );

  server.registerTool(
    VIDEO_OVERLAY_STATIC_GRAPHICS_TOOL,
    {
      title: 'Overlay Static Poster Graphics on Generated Video',
      description:
        'Deterministically overlay a same-canvas transparent PNG over generated MP4 bytes. Intended for poster-based image-to-video workflows so typography, information panels and sponsor logos remain exact while only the photographic scene is generative.',
      inputSchema: overlayInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const parsed = overlayInputSchema.parse(input);
      const result = await resolveRuntime().postProcessor.overlayStaticGraphics({
        videoBytes: decodeBase64(parsed.videoBase64, 'GENERATED_VIDEO_BASE64_INVALID'),
        overlayPngBytes: decodeBase64(
          parsed.overlayPngBase64,
          'GENERATED_VIDEO_OVERLAY_BASE64_INVALID',
        ),
      });
      return toolPayload({
        outputContentType: result.outputContentType,
        outputSha256: result.outputSha256,
        outputBase64: Buffer.from(result.outputBytes).toString('base64'),
        provider: result.provider,
      });
    },
  );

  server.registerTool(
    VIDEO_TRIM_TOOL,
    {
      title: 'Create Trimmed Video Derivative',
      description:
        'Create a deterministic trimmed MP4 derivative with FFmpeg. This supports deliverables such as a 5-second approval cut from the canonical 8-second scene-continuation candidate without weakening the canonical generation contract.',
      inputSchema: trimInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const parsed = trimInputSchema.parse(input);
      const result = await resolveRuntime().postProcessor.trim({
        videoBytes: decodeBase64(parsed.videoBase64, 'GENERATED_VIDEO_BASE64_INVALID'),
        startSeconds: parsed.startSeconds,
        durationSeconds: parsed.durationSeconds,
      });
      return toolPayload({
        outputContentType: result.outputContentType,
        outputSha256: result.outputSha256,
        outputBase64: Buffer.from(result.outputBytes).toString('base64'),
        provider: result.provider,
        startSeconds: parsed.startSeconds,
        durationSeconds: parsed.durationSeconds,
      });
    },
  );
}

function toolPayload<T extends Record<string, unknown>>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
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
