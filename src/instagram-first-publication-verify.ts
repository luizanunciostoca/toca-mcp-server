import * as z from 'zod/v4';
import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';
import { hashInstagramPublicationApprovalPayload } from './worker/instagram-publication-boundary.js';
import { parseInstagramPublishRequest } from './worker/instagram-publication-job.js';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().min(1),
  INSTAGRAM_FIRST_PUBLICATION_IDEMPOTENCY_KEY: z.string().min(1),
  INSTAGRAM_FIRST_PUBLICATION_CORRELATION_ID: z.string().min(1),
  INSTAGRAM_FIRST_PUBLICATION_APPROVED_REQUEST_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
  INSTAGRAM_FIRST_PUBLICATION_EXPECTED_ASSET_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
});

function isFeedPermalink(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['instagram.com', 'www.instagram.com'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\/p\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

try {
  const env = envSchema.parse(process.env);
  const config = loadConfig(process.env);
  if (!config.META_ENABLED) throw new Error('META_ENABLED_REQUIRED');

  const pool = createPostgresPool({ connectionString: env.DATABASE_URL });
  let receipt;
  try {
    const result = await pool.query<{
      provider: string;
      correlation_id: string;
      account_id: string;
      external_resource_id: string | null;
      state: string;
      idempotency_key: string;
      payload: unknown;
    }>(
      `select provider, correlation_id, account_id, external_resource_id, state, idempotency_key, payload
         from provider_publications
        where idempotency_key = $1`,
      [env.INSTAGRAM_FIRST_PUBLICATION_IDEMPOTENCY_KEY],
    );
    const row = result.rows[0];
    if (result.rows.length !== 1 || !row) throw new Error('FIRST_PUBLICATION_RECORD_NOT_FOUND');
    if (
      row.provider !== 'meta/instagram' ||
      row.correlation_id !== env.INSTAGRAM_FIRST_PUBLICATION_CORRELATION_ID ||
      row.account_id !== env.INSTAGRAM_BUSINESS_ACCOUNT_ID ||
      row.idempotency_key !== env.INSTAGRAM_FIRST_PUBLICATION_IDEMPOTENCY_KEY
    ) {
      throw new Error('FIRST_PUBLICATION_IDENTITY_MISMATCH');
    }
    if (row.state !== 'PUBLISHED') throw new Error('FIRST_PUBLICATION_NOT_PUBLISHED');
    if (!row.external_resource_id?.trim()) throw new Error('FIRST_PUBLICATION_MEDIA_ID_MISSING');

    // Parse exactly as approval preparation does, excluding appended _providerEvidence.
    const request = parseInstagramPublishRequest(row.payload);
    if (
      request.account.instagramAccountId !== row.account_id ||
      request.correlationId !== row.correlation_id ||
      request.idempotencyKey !== row.idempotency_key
    ) {
      throw new Error('FIRST_PUBLICATION_PERSISTED_IDENTITY_MISMATCH');
    }
    // This proves the staged input, not byte equality with Meta-transformed output.
    if (
      request.publicationAssetSha256 !== env.INSTAGRAM_FIRST_PUBLICATION_EXPECTED_ASSET_SHA256 ||
      request.creativeTruthBinding?.outputSha256 !== request.publicationAssetSha256
    ) {
      throw new Error('FIRST_PUBLICATION_PERSISTED_ASSET_MISMATCH');
    }
    const requestSha256 = hashInstagramPublicationApprovalPayload(request);
    if (requestSha256 !== env.INSTAGRAM_FIRST_PUBLICATION_APPROVED_REQUEST_SHA256) {
      throw new Error('FIRST_PUBLICATION_PERSISTED_APPROVAL_MISMATCH');
    }

    const metaClient = createMetaPublicationApiClient(config);
    const media = await metaClient.get(row.external_resource_id, {
      fields: 'id,media_type,permalink',
    });
    if (
      typeof media !== 'object' ||
      media === null ||
      Array.isArray(media) ||
      !('id' in media) ||
      media.id !== row.external_resource_id
    ) {
      throw new Error('FIRST_PUBLICATION_META_VERIFICATION_FAILED');
    }
    const providerMediaType = 'media_type' in media ? media.media_type : undefined;
    const permalink = 'permalink' in media ? media.permalink : undefined;
    // Feed IMAGE needs durable provider proof. Do not impose a feed permalink on STORY.
    if (
      request.mediaType === 'IMAGE' &&
      (providerMediaType !== 'IMAGE' || !isFeedPermalink(permalink))
    ) {
      throw new Error('FIRST_PUBLICATION_FEED_PROOF_MISSING');
    }

    receipt = {
      requestSha256,
      status: 'PUBLISHED',
      publicationId: media.id,
      instagramAccountId: request.account.instagramAccountId,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      publicationAssetSha256: request.publicationAssetSha256,
      requestMediaType: request.mediaType,
      providerMediaType: typeof providerMediaType === 'string' ? providerMediaType : null,
      permalink: typeof permalink === 'string' ? permalink : null,
    };
  } finally {
    await pool.end();
  }
  process.stdout.write(`INSTAGRAM_FIRST_PUBLICATION_VERIFY_RESULT=${JSON.stringify(receipt)}\n`);
} catch {
  // No success receipt or retry authorization on missing, mismatched or unavailable proof.
  process.stdout.write(
    `INSTAGRAM_FIRST_PUBLICATION_VERIFY_RESULT=${JSON.stringify({ status: 'RECONCILIATION_REQUIRED' })}\n`,
  );
  throw new Error('RECONCILIATION_REQUIRED');
}
