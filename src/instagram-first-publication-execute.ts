import { createHash } from 'node:crypto';

import { createRuntime } from './runtime.js';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_REQUIRED_ENV:${name}`);
  return value;
}

function decodeBase64(name: string): string {
  return Buffer.from(requiredEnv(name), 'base64').toString('utf8');
}

async function main(): Promise<void> {
  const approvedRequestSha256 = requiredEnv('INSTAGRAM_FIRST_PUBLICATION_APPROVED_REQUEST_SHA256');
  if (!/^[a-f0-9]{64}$/.test(approvedRequestSha256)) {
    throw new Error('INVALID_APPROVED_REQUEST_SHA256');
  }
  if (process.env.INSTAGRAM_PUBLICATION_WRITES_ENABLED !== 'true') {
    throw new Error('PUBLICATION_WRITES_NOT_ENABLED');
  }

  const instagramAccountId = requiredEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID');
  const mediaUrl = requiredEnv('INSTAGRAM_FIRST_PUBLICATION_MEDIA_URL');
  const caption = decodeBase64('INSTAGRAM_FIRST_PUBLICATION_CAPTION_BASE64');
  const correlationId = requiredEnv('INSTAGRAM_FIRST_PUBLICATION_CORRELATION_ID');
  const idempotencyKey = requiredEnv('INSTAGRAM_FIRST_PUBLICATION_IDEMPOTENCY_KEY');

  const request = {
    account: { instagramAccountId },
    mediaType: 'IMAGE' as const,
    mediaUrls: [mediaUrl],
    caption,
    correlationId,
    idempotencyKey,
  };
  const computed = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  if (computed !== approvedRequestSha256) {
    throw new Error(`APPROVED_REQUEST_SHA256_MISMATCH:${computed}`);
  }

  const runtime = await createRuntime();
  const result = await runtime.instagramPublication.publish(request);
  const publicationId = result.publicationId ?? result.id;
  if (!publicationId) throw new Error('PUBLICATION_RESULT_MISSING_ID');

  console.log(
    `INSTAGRAM_FIRST_PUBLICATION_EXECUTE_RESULT=${JSON.stringify({
      requestSha256: computed,
      status: 'PUBLISHED',
      publicationId,
      correlationId,
      idempotencyKey,
    })}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
