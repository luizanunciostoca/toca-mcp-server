import {
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  creativeEnhancementProvenanceSchema,
  type CreativeEnhancementProvenance,
} from '../../contracts/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import { OpenAiImageEditProvider } from './openai-image-edit-provider.js';

export interface CreativeTruthOpenAiEnhanceInput {
  readonly sourceAssetId: string;
  readonly sourceDriveFileId: string;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export type CreativeTruthOpenAiEnhanceResult = Awaited<
  ReturnType<OpenAiImageEditProvider['edit']>
> &
  CreativeEnhancementProvenance;

export class CreativeTruthOpenAiImageEnhancer {
  constructor(private readonly provider: OpenAiImageEditProvider) {}

  async enhance(input: CreativeTruthOpenAiEnhanceInput): Promise<CreativeTruthOpenAiEnhanceResult> {
    if (
      !input.sourceAssetId.trim() ||
      !input.sourceDriveFileId.trim() ||
      input.imageBytes.byteLength === 0
    ) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'OPENAI_ENHANCEMENT_SOURCE_BINDING_REQUIRED',
        false,
      );
    }

    const result = await this.provider.edit({
      sourceAssetId: input.sourceAssetId,
      sourceDriveFileId: input.sourceDriveFileId,
      imageBytes: input.imageBytes,
      contentType: input.contentType,
      creativeTruth: {
        brandScope: 'TOCA_DO_MORCEGO',
        policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
        creativeMode: 'REAL_PLUS_ENHANCEMENT',
      },
    });

    const provenance = creativeEnhancementProvenanceSchema.parse({
      policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
      creativeMode: 'REAL_PLUS_ENHANCEMENT',
      editorProvider: result.editorProvider,
      sourceAssetId: result.sourceAssetId,
      sourceDriveFileId: result.sourceDriveFileId,
      sourceSha256: result.sourceSha256,
      outputSha256: result.outputSha256,
      sourceImageBound: result.sourceImageBound,
      creativeTruthBound: result.creativeTruthBound,
      requiresVenueFidelityGate: result.requiresVenueFidelityGate,
    });

    return { ...result, ...provenance };
  }
}
