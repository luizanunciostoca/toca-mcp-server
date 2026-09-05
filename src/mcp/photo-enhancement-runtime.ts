import * as z from 'zod/v4';
import type { PhotoEnhancementRuntimeService } from '../creative/photo-enhancement-runtime.js';
import type { CoreCapabilityRuntimeBinding } from './core-execution.js';

const photoEnhancementSchema = z.object({
  contentItemId: z.string().min(1),
  sourceAssetId: z.string().min(1),
  sourceDriveFileId: z.string().min(1),
  correlationId: z.string().min(1),
});

export function resolvePhotoEnhancementRuntimeBinding(
  capabilityId: string,
  runtime: PhotoEnhancementRuntimeService | undefined,
): CoreCapabilityRuntimeBinding | undefined {
  if (capabilityId !== 'design.photo.enhance' || !runtime) return undefined;
  return {
    inputSchema: photoEnhancementSchema,
    execute: (input) => runtime.enhance(photoEnhancementSchema.parse(input)),
    sideEffectValidated: false,
  };
}
