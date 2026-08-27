import * as z from 'zod/v4';
import {
  creativeTruthPublicationBindingSchema,
  type CreativeTruthPublicationBinding,
} from '../contracts/creative-truth.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

const publishNowEnvelopeSchema = z.object({
  action: z.literal('PUBLISH_NOW'),
  correlationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

const publishNowCreativeTruthCommandSchema = publishNowEnvelopeSchema.extend({
  expectedAssetSha256: sha256Schema,
  creativeTruthBinding: creativeTruthPublicationBindingSchema,
});

export interface PublishNowCreativeTruthRuntime {
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly stagedAssetSha256: string;
}

export interface PublishNowCreativeTruthRequestFields {
  readonly creativeTruthBinding: CreativeTruthPublicationBinding;
  readonly publicationAssetSha256: string;
}

export function resolvePublishNowCreativeTruthRequestFields(
  command: unknown,
  runtime: PublishNowCreativeTruthRuntime,
): PublishNowCreativeTruthRequestFields | undefined {
  const envelope = publishNowEnvelopeSchema.safeParse(command);
  if (!envelope.success) return undefined;

  if (
    envelope.data.correlationId !== runtime.correlationId ||
    envelope.data.idempotencyKey !== runtime.idempotencyKey
  ) {
    return undefined;
  }

  const parsed = publishNowCreativeTruthCommandSchema.safeParse(command);
  if (!parsed.success) {
    throw new Error('INSTAGRAM_PUBLISH_NOW_CREATIVE_TRUTH_BINDING_INVALID');
  }

  const stagedAssetSha256 = sha256Schema.parse(runtime.stagedAssetSha256).toLowerCase();
  const expectedAssetSha256 = parsed.data.expectedAssetSha256.toLowerCase();
  const approvedOutputSha256 = parsed.data.creativeTruthBinding.outputSha256.toLowerCase();

  if (expectedAssetSha256 !== stagedAssetSha256) {
    throw new Error('INSTAGRAM_PUBLISH_NOW_STAGED_ASSET_HASH_MISMATCH');
  }
  if (approvedOutputSha256 !== stagedAssetSha256) {
    throw new Error('INSTAGRAM_PUBLISH_NOW_CREATIVE_TRUTH_HASH_MISMATCH');
  }

  return {
    creativeTruthBinding: parsed.data.creativeTruthBinding,
    publicationAssetSha256: stagedAssetSha256,
  };
}
