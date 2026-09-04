import { GoogleMetadataAccessTokenResolver } from './providers/gcp/google-metadata-access-token-resolver.js';
import { GoogleServiceIdentityOAuthResolver } from './providers/gcp/google-service-identity-oauth-resolver.js';
import { VertexVeoSceneContinuationVideoProvider } from './providers/gcp/vertex-veo-scene-continuation-video-provider.js';
import { GcsPhotoToVideoArtifactStore } from './providers/gcp/gcs-photo-to-video-artifact-store.js';
import { GcsPublicationAssetDelivery } from './providers/gcp/gcs-publication-asset-delivery.js';
import { GoogleDriveCreativeVideoSourceLoader } from './providers/google-drive/creative-video-source-loader.js';
import { sceneContinuationApprovalSchema } from './contracts/photo-to-video.js';

const projectId = requiredEnv('GCP_PROJECT_ID');
const bucketName = requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET');
const approvalRef = requiredEnv('THE_PARTY_REALPHOTO_V02_APPROVAL_REF');
const model = (process.env.VERTEX_VEO_MODEL?.trim() || 'veo-3.1-generate-001') as
  | 'veo-3.1-generate-001'
  | 'veo-3.1-fast-generate-001';

const driveResolver = new GoogleServiceIdentityOAuthResolver();
const driveTokenReference = { provider: 'gcp-service-identity-oauth', key: 'video-workspace' } as const;
const sourceLoader = new GoogleDriveCreativeVideoSourceLoader({
  secretResolver: driveResolver,
  accessTokenReference: driveTokenReference,
});
const cloudResolver = new GoogleMetadataAccessTokenResolver();
const provider = new VertexVeoSceneContinuationVideoProvider({
  projectId,
  artifactBucket: bucketName,
  accessTokenResolver: cloudResolver,
  accessTokenReference: { provider: 'gcp-metadata-oauth', key: 'cloud-platform' },
  location: 'us-central1',
  model,
});
const artifactStore = new GcsPhotoToVideoArtifactStore({ projectId, bucketName });
const delivery = new GcsPublicationAssetDelivery({
  projectId,
  bucketName,
  signedUrlTtlSeconds: 30 * 60,
});

const baseDirection =
  'Create a short vertical cinematic continuation of this exact real The Party photograph. Treat it as the factual visual anchor. Preserve the same people, identities, venue, equipment, materials, perspective and lighting context. Create physically plausible micro-motion only. Do not add people or crowd. Do not alter faces, bodies, architecture or equipment. Do not generate, redraw, repair, replace, morph or translate logos, written text, sponsor marks or venue signs; protected graphics will be restored deterministically in post-production. Premium realistic nightlife motion, natural anatomy, no surreal transformation, no generic nightclub replacement, no scene cut.';

const sources = [
  {
    id: 'S01_CROWD_PHONES',
    driveFileId: '1LvojIdMtrcGQvDcwZcBMHr-HE6w69nPW',
    sha256: '1186d894ecab2121de8dd4e583d59266b9133cc9f998d4f441738c0df54d68d6',
    prompt: `${baseDirection} Animate only subtle existing crowd and phone motion: small hand/phone shifts, believable body sway, gentle blue-purple haze and laser breathing, tiny exposure pulses and a controlled slow push-in. Keep crowd count and every visible person stable.`,
  },
  {
    id: 'S02_ENTRANCE',
    driveFileId: '1npxHFob9rbTPLAV7NIS6BDcHW7Y2VGMz',
    sha256: '0270c47b88eb3aee5291c9c9b276b1272367ea86dd34f8d4a5f638d29e48c4d0',
    prompt: `${baseDirection} Animate only the existing guests walking naturally toward the entrance, subtle facade light breathing and minimal palm movement with a restrained camera approach. Lock the exact Toca do Morcego architecture, entrance geometry and sign location. Do not invent guests, structures or signage.`,
  },
  {
    id: 'S03_TOAST',
    driveFileId: '1U0SMOJ-1pqu8E0-3s1VzxaZOg12vYIbt',
    sha256: '26a6f3f4449e327aa6189ae84ac9199530d1c8d52d0d9b792b636a76a4838e66',
    prompt: `${baseDirection} Animate the existing woman and toast naturally: tiny facial micro-expression, small hand and drink movement, slight hair motion, gentle breathing and warm-to-magenta ambient light movement across skin. Keep the surrounding crowd stable and preserve all product shapes and marks without redrawing them.`,
  },
  {
    id: 'S04_DJ',
    driveFileId: '1_ry01XYvHx7jpvY8ucNgYmK2znwDr27M',
    sha256: '909bfb67ee14aad905e5f5a274c130cd2dfb3cfee5967cfcc40137b50a7a3b62',
    prompt: `${baseDirection} Animate the exact DJ and Pioneer setup with tiny hand/body motion, realistic deck LED flicker, reflections, purple-magenta haze and a slow side-to-forward camera drift. Keep the DJ identity, mixer geometry, controls, can and all equipment unchanged. Do not invent equipment or people.`,
  },
  {
    id: 'S05_PORTRAIT',
    driveFileId: '1kqrQt1WEUzthV8qc2vn229hJPMRvA_j7',
    sha256: '8fad8535951c0e02c3e8e8a8114500ca9434f2fe47a4f38d27689534ea1f8fa2',
    prompt: `${baseDirection} Animate the existing portrait with extremely restrained natural motion: a tiny expression change, slight hair movement, subtle breathing and soft red-magenta club light passing across the subject. Preserve exact facial identity, sunglasses, clothing and body proportions. No added people.`,
  },
  {
    id: 'S06_FIRE',
    driveFileId: '1UufybsMOFHjR_r1b3FBl5qCXpc3JQ7a_',
    sha256: '6f7c67724f242fc33ae7fc002673e9474d564edb54a4aa2115e04cbf86714093',
    prompt: `${baseDirection} Animate the exact existing performer with controlled physically plausible arm/body micro-motion and realistic flame flicker/trails from the existing fire tools only. Preserve anatomy, face, clothing, tool count and environment. Do not add flames, props, performers or spectators.`,
  },
] as const;

const createdAt = new Date().toISOString();

type ShotResult = {
  id: string;
  contentItemId: string;
  outputSha256: string;
  artifactRef: string;
  objectName: string;
  providerJobId: string;
  providerModel: string;
  deliveryUrl: string;
};

async function generateShot(sourceDef: (typeof sources)[number]): Promise<ShotResult> {
  const source = await sourceLoader.load({
    driveFileId: sourceDef.driveFileId,
    expectedSha256: sourceDef.sha256,
  });
  const contentItemId = `VID-TP-REALPHOTO-V02-20260904-${sourceDef.id}`;
  const sourceAssetId = `TP-REALPHOTO-V02-${sourceDef.id}`;
  const approval = sceneContinuationApprovalSchema.parse({
    exceptionId: `VEX-TP-REALPHOTO-V02-20260904-${sourceDef.id}`,
    contentItemId,
    productId: 'THE_PARTY',
    operation: 'THE_PARTY',
    sourceAssetId,
    sourceSha256: source.sha256,
    requestedBy: 'USER_EXPLICIT_CHAT_COMMAND',
    approvedBy: 'USER_EXPLICIT_CHAT_COMMAND',
    approvalRef,
    allowSceneContinuation: true,
    allowEnvironmentExpansion: false,
    allowArchitecturalInvention: false,
    allowAiLogoGeneration: false,
    peopleConsentConfirmed: false,
    status: 'APPROVED',
    createdAt,
  });
  const generated = await provider.generate({
    contentItemId,
    sourceAssetId,
    operation: 'THE_PARTY',
    productId: 'THE_PARTY',
    inheritedVisualStandardId: 'THE_PARTY_HYBRID_MINIMALIST_V1',
    source,
    approval,
    prompt: sourceDef.prompt,
    seconds: 4,
    size: '720x1280',
    thePartyEnvironment: 'Toca do Morcego nightlife environment, Morro de Sao Paulo, Bahia',
    thePartyEditionId: 'TP-20260904',
  });
  const stored = await artifactStore.store({
    contentItemId,
    routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
    bytes: generated.outputBytes,
    expectedSha256: generated.outputSha256,
  });
  const deliveryUrl = await delivery.createVerifiedDeliveryUrl(
    stored.objectName,
    generated.outputSha256,
    'video/mp4',
  );
  return {
    id: sourceDef.id,
    contentItemId,
    outputSha256: generated.outputSha256,
    artifactRef: stored.artifactRef,
    objectName: stored.objectName,
    providerJobId: generated.providerJobId,
    providerModel: generated.providerModel,
    deliveryUrl,
  };
}

const results: ShotResult[] = [];
for (let index = 0; index < sources.length; index += 2) {
  const pair = sources.slice(index, index + 2);
  const generated = await Promise.all(pair.map((source) => generateShot(source)));
  results.push(...generated);
}

console.log(
  `THE_PARTY_REALPHOTO_V02_BATCH_RESULT=${JSON.stringify({
    schemaVersion: 1,
    provider: 'GOOGLE_VERTEX_VEO',
    model,
    secondsPerShot: 4,
    size: '720x1280',
    publicationAuthorized: false,
    schedulingAuthorized: false,
    marketingReadyAuthorized: false,
    rightsGate: 'UNVERIFIED_BLOCKED_FOR_MARKETING',
    approvalRef,
    results,
  })}`,
);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`THE_PARTY_REALPHOTO_V02_ENV_REQUIRED:${name}`);
  return value;
}
