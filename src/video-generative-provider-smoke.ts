import { createVideoGenerativeRuntimeFromEnvironment } from './mcp/video-generative-runtime.js';
import { GcsPublicationAssetDelivery } from './providers/gcp/gcs-publication-asset-delivery.js';

const CONTENT_ITEM_ID = 'VID-TP-20260904-DUAS-PISTAS-GEN-001' as const;
const EXPECTED_SOURCE_ASSET_ID = 'TP-GEN-0001' as const;
const EXPECTED_SOURCE_SHA256 =
  'e16d4bc9dba27eb60a826d9be6fd3dade2f1e2e48445e1155a421cf52ca7d85b' as const;

const CREATIVE_DIRECTION = [
  'Create a premium cinematic vertical scene continuation anchored strictly to the supplied The Party poster source.',
  'Animate only plausible photographic nightlife motion: a very subtle camera push-in, shallow depth breathing, realistic DJ-equipment LED flicker, small hand movement near the mixer, reflections moving across the equipment, and restrained orange/purple ambient light pulses.',
  'Preserve venue identity and all factual content. Do not invent architecture, people, crowds, performers, objects, text, offers, logos, or sponsors.',
  'Do not generate, redraw, repair, morph, translate, or replace any logo or typography.',
  'Motion must remain elegant and physically plausible, with no aggressive camera shake, warped hands, surreal transformations, heavy particles, strobing, crushed blacks, HDR look, or supersaturation.',
  'The result is a review candidate only and is not publication-authorized.',
].join(' ');

const expectedMainSha = requiredEnv('VIDEO_GENERATIVE_SMOKE_SOURCE_SHA');
const runtime = createVideoGenerativeRuntimeFromEnvironment(process.env);
const result = await runtime.generation.generate({
  contentItemId: CONTENT_ITEM_ID,
  routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
  creativeDirection: CREATIVE_DIRECTION,
});

if (
  result.manifest.contentItemId !== CONTENT_ITEM_ID ||
  result.manifest.sourceAssetId !== EXPECTED_SOURCE_ASSET_ID ||
  result.manifest.sourceSha256.toLowerCase() !== EXPECTED_SOURCE_SHA256 ||
  result.manifest.routeType !== 'GENERATIVE_SCENE_CONTINUATION_VIDEO' ||
  result.manifest.provider !== 'OPENAI_VIDEO_API' ||
  result.manifest.publicationEligible !== false
) {
  throw new Error('VIDEO_GENERATIVE_PROVIDER_SMOKE_MANIFEST_MISMATCH');
}

const projectId = requiredEnv('GCP_PROJECT_ID');
const bucketName = requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET');
const delivery = new GcsPublicationAssetDelivery({
  projectId,
  bucketName,
  signedUrlTtlSeconds: 60 * 60,
});
const deliveryUrl = await delivery.createVerifiedDeliveryUrl(
  result.manifest.artifactObjectName,
  result.manifest.outputSha256,
  'video/mp4',
);

process.stdout.write(
  `VIDEO_GENERATIVE_PROVIDER_SMOKE_RESULT=${JSON.stringify({
    schemaVersion: 1,
    sourceSha: expectedMainSha,
    status: result.manifest.status,
    contentItemId: result.manifest.contentItemId,
    routeType: result.manifest.routeType,
    sourceAssetId: result.manifest.sourceAssetId,
    sourceSha256: result.manifest.sourceSha256,
    outputSha256: result.manifest.outputSha256,
    artifactRef: result.manifest.artifactRef,
    artifactObjectName: result.manifest.artifactObjectName,
    provider: result.manifest.provider,
    providerJobId: result.manifest.providerJobId ?? null,
    providerModel: result.manifest.providerModel ?? null,
    seconds: result.manifest.seconds,
    size: result.manifest.size,
    requiresPostGenerationHumanReview: true,
    publicationEligible: false,
    publicationAuthorized: false,
    deliveryUrl,
  })}\n`,
);

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`VIDEO_GENERATIVE_SMOKE_ENV_REQUIRED:${key}`);
  return value;
}
