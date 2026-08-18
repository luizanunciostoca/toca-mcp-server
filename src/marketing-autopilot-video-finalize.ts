import { readFile, writeFile } from 'node:fs/promises';
import { ControlledPhotoToVideoFinalizationService } from './creative/controlled-photo-to-video-finalization.js';
import {
  photoToVideoCandidateManifestSchema,
  photoToVideoReviewEvidenceSchema,
} from './contracts/photo-to-video.js';
import { EnvironmentSecretResolver } from './core/secrets.js';
import { GoogleSheetsRestClient } from './providers/google-sheets/client.js';
import { GoogleSheetsPhotoToVideoContentWriteback } from './providers/google-sheets/photo-to-video-content-writeback.js';
import { GoogleSheetsPhotoToVideoRegistry } from './providers/google-sheets/photo-to-video-registry.js';

const args = parseArgs(process.argv.slice(2));
const secrets = new EnvironmentSecretResolver(process.env);
const sheetsTokenEnvKey = requiredEnv('GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY');
const sheets = new GoogleSheetsRestClient(secrets, {
  tokenReference: { provider: 'env', key: sheetsTokenEnvKey },
});
const registry = new GoogleSheetsPhotoToVideoRegistry(sheets);
const writeback = new GoogleSheetsPhotoToVideoContentWriteback(sheets);
const service = new ControlledPhotoToVideoFinalizationService({ registry, writeback });
const outputBytes = new Uint8Array(await readFile(args.output));
const candidateManifest = photoToVideoCandidateManifestSchema.parse(
  JSON.parse(await readFile(args.manifest, 'utf8')),
);
const reviewEvidence = photoToVideoReviewEvidenceSchema.parse(
  JSON.parse(await readFile(args.review, 'utf8')),
);
const finalManifest = await service.finalize({
  outputBytes,
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
    exactAssetBinding: true,
    readyForPrepare: true,
    canonicalFinalWriteback: true,
    publicationAuthorized: false,
    finalManifestPath: args.finalManifest,
  })}\n`,
);

interface CliArgs {
  readonly output: string;
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
  const output = required(values, 'output');
  return {
    output,
    manifest: required(values, 'manifest'),
    review: required(values, 'review'),
    finalManifest: values.get('final-manifest')?.trim() || `${output}.final.json`,
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
