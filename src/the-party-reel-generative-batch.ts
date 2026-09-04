import { GoogleMetadataAccessTokenResolver } from './providers/gcp/google-metadata-access-token-resolver.js';
import { GoogleServiceIdentityOAuthResolver } from './providers/gcp/google-service-identity-oauth-resolver.js';
import { VertexVeoSceneContinuationVideoProvider } from './providers/gcp/vertex-veo-scene-continuation-video-provider.js';
import { GcsPhotoToVideoArtifactStore } from './providers/gcp/gcs-photo-to-video-artifact-store.js';
import { GcsPublicationAssetDelivery } from './providers/gcp/gcs-publication-asset-delivery.js';
import { GoogleDriveCreativeVideoSourceLoader } from './providers/google-drive/creative-video-source-loader.js';
import { sceneContinuationApprovalSchema } from './contracts/photo-to-video.js';

const projectId = requiredEnv('GCP_PROJECT_ID');
const bucketName = requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET');
const approvalRef = requiredEnv('THE_PARTY_REEL_BATCH_APPROVAL_REF');
const model = (process.env.VERTEX_VEO_MODEL?.trim() || 'veo-3.1-generate-001') as
  | 'veo-3.1-generate-001'
  | 'veo-3.1-fast-generate-001';

const driveResolver = new GoogleServiceIdentityOAuthResolver();
const driveTokenReference = { provider: 'gcp-service-identity-oauth', key: 'the-party-reel-batch' } as const;
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

const sources = [
  {
    id: 'S01_WOMAN_CUP', driveFileId: '1QqgfisDybBLDogZtfeqi2jyw0Z5TaKUc', sha256: 'f3f6cbefacea0367ce70f38c0d08fde01a00386dd87e5212ac80d9e31c1fb9af',
    prompt: 'Animate the photographic nightlife portion only. Subtle natural facial micro-expression, hands and drink movement, slight hair motion, warm-to-magenta club light breathing, gentle camera push-in. Preserve identities and do not invent people. No scene cut.',
  },
  {
    id: 'S02_NOT_ANY_PARTY', driveFileId: '1ZsmLuqL1tVp0hliPX9ho5yaCgh95I27f', sha256: 'a4fafe3b833138351ac60d42f8ef616812c664a25620a7b7a9fba888739ee4e8',
    prompt: 'Bring the lower crowd-and-phones photographic scene to life with subtle phone movement, hands rising, realistic purple and blue laser haze, tiny exposure pulses and a controlled push forward into the crowd. Preserve the same people and venue; no new crowd or architecture.',
  },
  {
    id: 'S03_THIS_FRIDAY', driveFileId: '1uS8EFeu8nGhQTtNiALg_0yXaSNyNg20c', sha256: '651ff66c4cca870304a7097fe7cb160f3e2b1b5bdbec8b14ffda97cb9178f331',
    prompt: 'Animate the photographic layers with premium nightlife realism: slight human micro-motion in the portrait, guests approaching the venue, subtle palm and light movement, crowd energy at the bottom, gentle vertical parallax. Do not alter venue geometry or add people.',
  },
  {
    id: 'S04_DJ_SCHEDULE', driveFileId: '1_WktjqnVJWrrEjZxIFYBxDWb4jLPg1eg', sha256: 'be9568d9912b24fbe393f05d8da0bf98d7111249ec9f483baf70298d78ccc06b',
    prompt: 'Animate the DJ and mixer photographic scene: tiny body and hand movement, LED flicker, moving reflections, purple-magenta haze and a slow side-to-forward camera drift. Keep the same DJ, equipment and venue; no invented signage or people.',
  },
  {
    id: 'S05_WOMAN_DANCE', driveFileId: '1dlsi0pRJ0CHLw61Y_Wqnmy2vzPL5wOds', sha256: '240d1cfc20ec155afc13d9d17194036a5338895b69bb3a9ce1a2c4914a90e2b3',
    prompt: 'Animate the dancing woman naturally with small shoulder, arm and hair motion, genuine smile continuity, crowd micro-motion and purple club lights sweeping softly behind her. Preserve her identity and the surrounding people; no new subjects.',
  },
  {
    id: 'S06_STORYBOARD', driveFileId: '1fNAZsemgFEQhme6l3S2pxvB4NxjAlzW-', sha256: 'd64e32bdf41f7eea918442256dfe36bc7c84c13ffcd64a8c630e4db0a8b60ce5',
    prompt: 'Animate the photographic panels as one coherent nightlife world with subtle crowd and phone movement, venue light breathing, DJ micro-motion and a restrained forward camera feel. Keep panel composition stable and avoid changing written content; no new people or venue geometry.',
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
  const contentItemId = `VID-TP-REEL-20260904-${sourceDef.id}`;
  const sourceAssetId = `TP-REEL-${sourceDef.id}`;
  const approval = sceneContinuationApprovalSchema.parse({
    exceptionId: `VEX-TP-REEL-20260904-${sourceDef.id}`,
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
  `THE_PARTY_REEL_BATCH_RESULT=${JSON.stringify({
    schemaVersion: 1,
    provider: 'GOOGLE_VERTEX_VEO',
    model,
    secondsPerShot: 4,
    size: '720x1280',
    publicationAuthorized: false,
    schedulingAuthorized: false,
    approvalRef,
    results,
  })}`,
);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`THE_PARTY_REEL_BATCH_ENV_REQUIRED:${name}`);
  return value;
}
