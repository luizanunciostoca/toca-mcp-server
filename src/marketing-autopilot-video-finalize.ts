import { readFile, writeFile } from 'node:fs/promises';
import { ControlledPhotoToVideoFinalizationService } from './creative/controlled-photo-to-video-finalization.js';
import {
  photoToVideoCandidateManifestSchema,
  photoToVideoReviewEvidenceSchema,
} from './contracts/photo-to-video.js';
import { EnvironmentSecretResolver } from './core/secrets.js';
import { GcsPhotoToVideoArtifactStore } from './providers/gcp/gcs-photo-to-video-artifact-store.js';
import { GoogleDriveCreativeTruthBrandAssetLoader } from './providers/google-drive/creative-truth-brand-asset-loader.js';
import { GoogleDriveCreativeVideoSourceLoader } from './providers/google-drive/creative-video-source-loader.js';
import { GoogleSheetsRestClient } from './providers/google-sheets/client.js';
import { GoogleSheetsPhotoToVideoContentWriteback } from './providers/google-sheets/photo-to-video-content-writeback.js';
import { GoogleSheetsPhotoToVideoParentPolicyGuard } from './providers/google-sheets/photo-to-video-policy-guard.js';
import { GoogleSheetsPhotoToVideoRegistry } from './providers/google-sheets/photo-to-video-registry.js';

const args = parseArgs(process.argv.slice(2));
const secrets = new EnvironmentSecretResolver(process.env);
const sheetsTokenEnvKey = requiredEnv('GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY');
const driveTokenEnvKey = process.env.GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY?.trim() || sheetsTokenEnvKey;
const gcpProjectId = requiredEnv('GCP_PROJECT_ID');
const artifactBucket = requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET');
const sheets = new GoogleSheetsRestClient(secrets, {
  tokenReference: { provider: 'env', key: sheetsTokenEnvKey },
});
const policyGuard = new GoogleSheetsPhotoToVideoParentPolicyGuard(sheets);
const registry = new GoogleSheetsPhotoToVideoRegistry(sheets);
const writeback = new GoogleSheetsPhotoToVideoContentWriteback(sheets);
const artifactStore = new GcsPhotoToVideoArtifactStore({
  projectId: gcpProjectId,
  bucketName: artifactBucket,
});
const sourceLoader = new GoogleDriveCreativeVideoSourceLoader({
  secretResolver: secrets,
  accessTokenReference: { provider: 'env', key: driveTokenEnvKey },
});
const brandLoader = new GoogleDriveCreativeTruthBrandAssetLoader({
  secretResolver: secrets,
  accessTokenReference: { provider: 'env', key: driveTokenEnvKey },
});
const service = new ControlledPhotoToVideoFinalizationService({
  policyGuard,
  registry,
  writeback,
  artifactStore,
  sourceLoader,
  brandLoader,
});
const candidateManifest = photoToVideoCandidateManifestSchema.parse(
  JSON.parse(await readFile(args.manifest, 'utf8')),
);
const reviewEvidence = photoToVideoReviewEvidenceSchema.parse(
  JSON.parse(await readFile(args.review, 'utf8')),
);
const finalManifest = await service.finalize({
  candidateManifest,
  reviewEvidence,
});
await writeFile(args.finalManifest, `${JSON.stringify(finalManifest, null, 2)}\n`, 'utf8');
process.stdout.write(
  `${JSON.stringify({
    status: finalManifest.status,
    contentItemId: finalManifest.candidate.contentItemId,
    routeType: finalManifest.candidate.routeType,
    finalAssetSha256: finalManifest.finalAssetSha256,
    finalArtifactRef: finalManifest.finalArtifactRef,
    exactAssetBinding: true,
    readyForPrepare: true,
    canonicalParentPolicyChecked: true,
    canonicalFinalWriteback: true,
    durableArtifactReadback: true,
    sourceAndBrandRevalidated: true,
    publicationAuthorized: false,
    finalManifestPath: args.finalManifest,
  })}\n`,
);

interface CliArgs {
  readonly manifest: string;
  readonly review: string;
  readonly finalManifest: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error('VIDEO_FINALIZE_ARGS_INVALID');
    values.set(key.slice(2), value);
  }
  if (values.has('now-iso')) throw new Error('VIDEO_FINALIZE_CALLER_TIME_FORBIDDEN');
  if (values.has('output')) throw new Error('VIDEO_FINALIZE_CALLER_OUTPUT_FORBIDDEN');
  const manifest = required(values, 'manifest');
  return {
    manifest,
    review: required(values, 'review'),
    finalManifest: values.get('final-manifest')?.trim() || `${manifest}.final.json`,
  };
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`VIDEO_FINALIZE_ARG_REQUIRED:${key}`);
  return value;
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`VIDEO_FINALIZE_ENV_REQUIRED:${key}`);
  return value;
}
