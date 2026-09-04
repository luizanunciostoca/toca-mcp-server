import { createHash } from 'node:crypto';
import { GcsPublicationAssetDelivery } from './providers/gcp/gcs-publication-asset-delivery.js';

const projectId = requiredEnv('GCP_PROJECT_ID');
const bucketName = requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET');
const prefix = requiredEnv('VIDEO_RECOVERY_PREFIX');

const accessToken = await metadataAccessToken();
const listUrl = new URL(
  `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o`,
);
listUrl.searchParams.set('prefix', prefix);
listUrl.searchParams.set('fields', 'items(name,timeCreated,updated,size,contentType)');

const listResponse = await fetch(listUrl, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
if (!listResponse.ok) throw new Error(`VIDEO_RECOVERY_LIST_FAILED:${listResponse.status}`);
const listPayload = (await listResponse.json()) as {
  items?: Array<{
    name?: unknown;
    timeCreated?: unknown;
    updated?: unknown;
    size?: unknown;
    contentType?: unknown;
  }>;
};
const candidates = (listPayload.items ?? [])
  .flatMap((item) => {
    const name = typeof item.name === 'string' ? item.name : '';
    const updated = typeof item.updated === 'string' ? item.updated : '';
    const timeCreated = typeof item.timeCreated === 'string' ? item.timeCreated : '';
    const contentType = typeof item.contentType === 'string' ? item.contentType : '';
    if (!name.startsWith(prefix) || !name.endsWith('.mp4') || contentType !== 'video/mp4') return [];
    return [{ name, updated, timeCreated }];
  })
  .sort((left, right) => Date.parse(right.updated) - Date.parse(left.updated));
if (candidates.length === 0) throw new Error('VIDEO_RECOVERY_CANDIDATE_NOT_FOUND');
const selected = candidates[0]!;

const mediaUrl = new URL(
  `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(selected.name)}`,
);
mediaUrl.searchParams.set('alt', 'media');
const mediaResponse = await fetch(mediaUrl, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
if (!mediaResponse.ok) throw new Error(`VIDEO_RECOVERY_FETCH_FAILED:${mediaResponse.status}`);
const bytes = new Uint8Array(await mediaResponse.arrayBuffer());
if (bytes.byteLength < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') {
  throw new Error('VIDEO_RECOVERY_NOT_MP4');
}
const sha256 = createHash('sha256').update(bytes).digest('hex');
const delivery = new GcsPublicationAssetDelivery({
  projectId,
  bucketName,
  signedUrlTtlSeconds: 15 * 60,
});
const deliveryUrl = await delivery.createVerifiedDeliveryUrl(selected.name, sha256, 'video/mp4');

console.log(
  `VIDEO_GENERATIVE_RECOVERY_RESULT=${JSON.stringify({
    schemaVersion: 1,
    contentItemId: 'VID-TP-20260904-DUAS-PISTAS-GEN-001',
    objectName: selected.name,
    sha256,
    sizeBytes: bytes.byteLength,
    timeCreated: selected.timeCreated,
    updated: selected.updated,
    candidateCount: candidates.length,
    deliveryUrl,
    publicationAuthorized: false,
    generationRepeated: false,
  })}`,
);

async function metadataAccessToken(): Promise<string> {
  const response = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!response.ok) throw new Error(`VIDEO_RECOVERY_METADATA_TOKEN_FAILED:${response.status}`);
  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
    throw new Error('VIDEO_RECOVERY_METADATA_TOKEN_INVALID');
  }
  return payload.access_token;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VIDEO_RECOVERY_ENV_REQUIRED:${name}`);
  return value;
}
