import { GcsPublicationAssetDelivery } from './providers/gcp/gcs-publication-asset-delivery.js';

interface ReviewLinkArgs {
  readonly objectName: string;
  readonly expectedSha256: string;
  readonly correlationId: string;
}

const args = parseArgs(process.argv.slice(2));
const projectId = requiredEnv('GCP_PROJECT_ID');
const bucketName = requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET');

const delivery = new GcsPublicationAssetDelivery({
  projectId,
  bucketName,
  signedUrlTtlSeconds: 180,
});

const url = await delivery.createVerifiedDeliveryUrl(
  args.objectName,
  args.expectedSha256,
  'image/jpeg',
);

process.stdout.write(
  `${JSON.stringify({
    correlationId: args.correlationId,
    objectName: args.objectName,
    expectedSha256: args.expectedSha256,
    contentType: 'image/jpeg',
    reviewUrl: url,
    expiresInSeconds: 180,
  })}\n`,
);

function parseArgs(values: readonly string[]): ReviewLinkArgs {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith('--') || !value?.trim()) {
      throw new Error('PHOTO_ENHANCEMENT_REVIEW_LINK_ARGS_INVALID');
    }
    parsed.set(flag.slice(2), value.trim());
  }

  const expectedSha256 = requiredArg(parsed, 'expected-sha256').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error('PHOTO_ENHANCEMENT_REVIEW_LINK_SHA_INVALID');
  }

  return {
    objectName: requiredArg(parsed, 'object-name'),
    expectedSha256,
    correlationId: requiredArg(parsed, 'correlation-id'),
  };
}

function requiredArg(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`PHOTO_ENHANCEMENT_REVIEW_LINK_ARG_REQUIRED:${key}`);
  return value;
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`PHOTO_ENHANCEMENT_REVIEW_LINK_ENV_REQUIRED:${key}`);
  return value;
}
