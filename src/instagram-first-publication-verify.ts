import * as z from 'zod/v4';
import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().min(1),
  INSTAGRAM_FIRST_PUBLICATION_IDEMPOTENCY_KEY: z.string().min(1),
  INSTAGRAM_FIRST_PUBLICATION_CORRELATION_ID: z.string().min(1),
  INSTAGRAM_FIRST_PUBLICATION_APPROVED_REQUEST_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
});

const env = envSchema.parse(process.env);
const config = loadConfig(process.env);
if (!config.META_ENABLED) throw new Error('META_ENABLED_REQUIRED');

const pool = createPostgresPool({ connectionString: env.DATABASE_URL });
try {
  const result = await pool.query<{
    correlation_id: string;
    account_id: string;
    external_resource_id: string | null;
    state: string;
    idempotency_key: string;
    last_error: string | null;
  }>(
    `select correlation_id, account_id, external_resource_id, state, idempotency_key, last_error
       from provider_publications
      where idempotency_key = $1`,
    [env.INSTAGRAM_FIRST_PUBLICATION_IDEMPOTENCY_KEY],
  );
  const row = result.rows[0];
  if (!row) throw new Error('FIRST_PUBLICATION_RECORD_NOT_FOUND');
  if (row.correlation_id !== env.INSTAGRAM_FIRST_PUBLICATION_CORRELATION_ID) {
    throw new Error('FIRST_PUBLICATION_CORRELATION_MISMATCH');
  }
  if (row.account_id !== env.INSTAGRAM_BUSINESS_ACCOUNT_ID) {
    throw new Error('FIRST_PUBLICATION_ACCOUNT_MISMATCH');
  }
  if (row.state !== 'PUBLISHED') {
    throw new Error(`FIRST_PUBLICATION_NOT_PUBLISHED:${row.state}:${row.last_error ?? ''}`);
  }
  if (!row.external_resource_id) throw new Error('FIRST_PUBLICATION_MEDIA_ID_MISSING');

  const metaClient = createMetaPublicationApiClient(config);
  const media = await metaClient.get(row.external_resource_id, { fields: 'id,media_type,permalink' });
  if (
    typeof media !== 'object' ||
    media === null ||
    Array.isArray(media) ||
    (media as { id?: unknown }).id !== row.external_resource_id
  ) {
    throw new Error('FIRST_PUBLICATION_META_VERIFICATION_FAILED');
  }

  process.stdout.write(
    `INSTAGRAM_FIRST_PUBLICATION_VERIFY_RESULT=${JSON.stringify({
      requestSha256: env.INSTAGRAM_FIRST_PUBLICATION_APPROVED_REQUEST_SHA256,
      status: 'PUBLISHED',
      publicationId: row.external_resource_id,
      correlationId: row.correlation_id,
      idempotencyKey: row.idempotency_key,
      permalink:
        typeof (media as { permalink?: unknown }).permalink === 'string'
          ? (media as { permalink: string }).permalink
          : null,
    })}\n`,
  );
} finally {
  await pool.end();
}
