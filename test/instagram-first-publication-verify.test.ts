import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstagramPublishRequest } from '../src/providers/instagram/instagram-contracts.js';
import { hashInstagramPublicationApprovalPayload } from '../src/worker/instagram-publication-boundary.js';

const database = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }));
const provider = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/config.js', () => ({
  loadConfig: () => ({ META_ENABLED: true }),
}));
vi.mock('../src/persistence/postgres.js', () => ({
  createPostgresPool: () => database,
}));
vi.mock('../src/providers/meta/meta-publication-client.js', () => ({
  createMetaPublicationApiClient: () => provider,
}));

const assetSha256 = 'a'.repeat(64);
const accountId = '17841400000000001';
const mediaId = '18000000000000001';
const permalink = 'https://www.instagram.com/p/Approved_123/';
function requestFixture(): InstagramPublishRequest {
  return {
    account: { pageId: '100000000000001', instagramAccountId: accountId },
    mediaType: 'IMAGE',
    mediaUrls: ['https://storage.googleapis.com/test-bucket/approved.jpg'],
    caption: 'Original approved copy, unchanged.',
    correlationId: 'approved-correlation',
    idempotencyKey: 'approved-idempotency',
    publicationAssetSha256: assetSha256,
    creativeTruthBinding: {
      policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
      standardId: 'approved-standard',
      creativeId: 'approved-creative',
      outputSha256: assetSha256,
      brandIntegrityStatus: 'PASSED',
      venueFidelityStatus: 'PASSED',
      qualityGateStatus: 'PASSED',
      exactAssetBinding: true,
    },
  };
}
function rowFixture() {
  const request = requestFixture();
  return {
    provider: 'meta/instagram',
    account_id: accountId,
    correlation_id: request.correlationId,
    idempotency_key: request.idempotencyKey,
    state: 'PUBLISHED',
    external_resource_id: mediaId,
    payload: request as unknown,
  };
}

let output: string[];
function receipt(): Record<string, unknown> {
  expect(output).toHaveLength(1);
  const line = output[0]!;
  expect(line).toMatch(/^INSTAGRAM_FIRST_PUBLICATION_VERIFY_RESULT=/);
  return JSON.parse(line.slice(line.indexOf('=') + 1)) as Record<string, unknown>;
}
async function expectReconciliation(): Promise<void> {
  await expect(import('../src/instagram-first-publication-verify.js')).rejects.toThrow(
    'RECONCILIATION_REQUIRED',
  );
  expect(receipt()).toEqual({ status: 'RECONCILIATION_REQUIRED' });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  output = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  vi.stubEnv('DATABASE_URL', 'postgres://offline.invalid/test');
  vi.stubEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID', accountId);
  vi.stubEnv('INSTAGRAM_FIRST_PUBLICATION_CORRELATION_ID', 'approved-correlation');
  vi.stubEnv('INSTAGRAM_FIRST_PUBLICATION_IDEMPOTENCY_KEY', 'approved-idempotency');
  vi.stubEnv('INSTAGRAM_FIRST_PUBLICATION_EXPECTED_ASSET_SHA256', assetSha256);
  vi.stubEnv(
    'INSTAGRAM_FIRST_PUBLICATION_APPROVED_REQUEST_SHA256',
    hashInstagramPublicationApprovalPayload(requestFixture()),
  );
  database.query.mockResolvedValue({ rows: [rowFixture()] });
  database.end.mockResolvedValue(undefined);
  provider.get.mockResolvedValue({
    id: mediaId,
    media_type: 'IMAGE',
    permalink,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Instagram persisted first-publication readback proof', () => {
  it('proves the persisted approved request and staged input asset with provider readback', async () => {
    await import('../src/instagram-first-publication-verify.js');
    expect(receipt()).toEqual({
      status: 'PUBLISHED',
      requestSha256: hashInstagramPublicationApprovalPayload(requestFixture()),
      publicationId: mediaId,
      instagramAccountId: accountId,
      correlationId: 'approved-correlation',
      idempotencyKey: 'approved-idempotency',
      publicationAssetSha256: assetSha256,
      requestMediaType: 'IMAGE',
      providerMediaType: 'IMAGE',
      permalink,
    });
    expect(database.query).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^select provider,.*payload\s+from provider_publications/),
      ['approved-idempotency'],
    );
    expect(provider.get).toHaveBeenCalledExactlyOnceWith(mediaId, {
      fields: 'id,media_type,permalink',
    });
    expect(database.end).toHaveBeenCalledOnce();
  });

  it('excludes appended _providerEvidence from the canonical approval hash', async () => {
    const row = rowFixture();
    row.payload = {
      ...requestFixture(),
      _providerEvidence: {
        permalink: 'https://untrusted.invalid/not-proof',
        providerPublishedAt: '2026-10-21T00:00:00Z',
        reconciliationSource: 'PROVIDER_LOOKUP',
        requestSha256: 'b'.repeat(64),
      },
    };
    database.query.mockResolvedValue({ rows: [row] });
    await import('../src/instagram-first-publication-verify.js');
    expect(receipt().requestSha256).toBe(hashInstagramPublicationApprovalPayload(requestFixture()));
    expect(receipt().permalink).toBe(permalink);
    expect(provider.get).toHaveBeenCalledOnce();
  });

  it.each([
    ['caption', { caption: 'Unapproved copy' }],
    [
      'account',
      {
        account: {
          pageId: '100000000000001',
          instagramAccountId: 'other-account',
        },
      },
    ],
    ['page', { account: { pageId: 'other-page', instagramAccountId: accountId } }],
    ['asset', { publicationAssetSha256: 'b'.repeat(64) }],
    ['missing asset', { publicationAssetSha256: undefined }],
    ['media URL', { mediaUrls: ['https://storage.googleapis.com/test-bucket/altered.jpg'] }],
    ['media type', { mediaType: 'STORY' }],
    ['correlation', { correlationId: 'other-correlation' }],
    ['idempotency', { idempotencyKey: 'other-idempotency' }],
    ['missing Creative Truth', { creativeTruthBinding: undefined }],
    [
      'Creative Truth asset',
      {
        creativeTruthBinding: {
          ...requestFixture().creativeTruthBinding,
          outputSha256: 'b'.repeat(64),
        },
      },
    ],
    [
      'Creative Truth identity',
      {
        creativeTruthBinding: {
          ...requestFixture().creativeTruthBinding,
          creativeId: 'other-creative',
        },
      },
    ],
    [
      'Creative Truth gate',
      {
        creativeTruthBinding: {
          ...requestFixture().creativeTruthBinding,
          qualityGateStatus: 'FAILED',
        },
      },
    ],
    [
      'Creative Truth exactness',
      {
        creativeTruthBinding: {
          ...requestFixture().creativeTruthBinding,
          exactAssetBinding: false,
        },
      },
    ],
  ])('rejects altered persisted %s before provider access', async (_label, patch) => {
    database.query.mockResolvedValue({
      rows: [{ ...rowFixture(), payload: { ...requestFixture(), ...patch } }],
    });
    await expectReconciliation();
    expect(provider.get).not.toHaveBeenCalled();
    expect(database.end).toHaveBeenCalledOnce();
  });

  it.each([undefined, null, '', '{}', [], {}])(
    'rejects missing or invalid persisted payload %j',
    async (payload) => {
      database.query.mockResolvedValue({
        rows: [{ ...rowFixture(), payload }],
      });
      await expectReconciliation();
      expect(provider.get).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['provider', { provider: 'another-provider' }],
    ['account', { account_id: 'other-account' }],
    ['correlation', { correlation_id: 'other-correlation' }],
    ['idempotency', { idempotency_key: 'other-idempotency' }],
    ['unknown outcome', { state: 'UNKNOWN' }],
    ['processing', { state: 'PROCESSING' }],
    ['missing media ID', { external_resource_id: null }],
    ['empty media ID', { external_resource_id: '  ' }],
  ])('rejects mismatched row %s without a fresh publication attempt', async (_label, patch) => {
    database.query.mockResolvedValue({
      rows: [{ ...rowFixture(), ...patch }],
    });
    await expectReconciliation();
    expect(provider.get).not.toHaveBeenCalled();
    expect(database.query).toHaveBeenCalledOnce();
  });

  it.each([{ rows: [] }, { rows: [rowFixture(), rowFixture()] }])(
    'rejects missing or ambiguous rows',
    async ({ rows }) => {
      database.query.mockResolvedValue({ rows });
      await expectReconciliation();
      expect(provider.get).not.toHaveBeenCalled();
    },
  );

  it('does not echo an approved hash that differs from persisted truth', async () => {
    vi.stubEnv('INSTAGRAM_FIRST_PUBLICATION_APPROVED_REQUEST_SHA256', 'b'.repeat(64));
    await expectReconciliation();
    expect(provider.get).not.toHaveBeenCalled();
  });

  it('requires the expected staged input asset from the command', async () => {
    vi.stubEnv('INSTAGRAM_FIRST_PUBLICATION_EXPECTED_ASSET_SHA256', 'b'.repeat(64));
    await expectReconciliation();
    expect(provider.get).not.toHaveBeenCalled();
  });

  it.each([undefined, ''])(
    'fails closed without a valid expected asset environment binding',
    async (value) => {
      vi.stubEnv('INSTAGRAM_FIRST_PUBLICATION_EXPECTED_ASSET_SHA256', value);
      await expectReconciliation();
      expect(database.query).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    [],
    {},
    { id: 'other-media', media_type: 'IMAGE', permalink },
    { id: mediaId, permalink },
    { id: mediaId, media_type: 'VIDEO', permalink },
    { id: mediaId, media_type: 'CAROUSEL_ALBUM', permalink },
    { id: mediaId, media_type: 'IMAGE' },
    { id: mediaId, media_type: 'IMAGE', permalink: null },
    { id: mediaId, media_type: 'IMAGE', permalink: '' },
    { id: mediaId, media_type: 'IMAGE', permalink: ' ' },
    { id: mediaId, media_type: 'IMAGE', permalink: 'not-a-url' },
    {
      id: mediaId,
      media_type: 'IMAGE',
      permalink: 'http://www.instagram.com/p/Approved_123/',
    },
    {
      id: mediaId,
      media_type: 'IMAGE',
      permalink: 'https://instagram.com.evil.invalid/p/Approved_123/',
    },
    {
      id: mediaId,
      media_type: 'IMAGE',
      permalink: 'https://evil@www.instagram.com/p/Approved_123/',
    },
    {
      id: mediaId,
      media_type: 'IMAGE',
      permalink: 'https://www.instagram.com/',
    },
    {
      id: mediaId,
      media_type: 'IMAGE',
      permalink: 'https://www.instagram.com/reel/Approved_123/',
    },
  ])('rejects missing or mismatched FEED IMAGE provider proof %j', async (media) => {
    provider.get.mockResolvedValue(media);
    await expectReconciliation();
    expect(database.query).toHaveBeenCalledOnce();
    expect(provider.get).toHaveBeenCalledOnce();
    expect(database.end).toHaveBeenCalledOnce();
  });

  it('does not indiscriminately require a feed permalink for an approved STORY', async () => {
    const request = { ...requestFixture(), mediaType: 'STORY' as const };
    vi.stubEnv(
      'INSTAGRAM_FIRST_PUBLICATION_APPROVED_REQUEST_SHA256',
      hashInstagramPublicationApprovalPayload(request),
    );
    database.query.mockResolvedValue({
      rows: [{ ...rowFixture(), payload: request }],
    });
    provider.get.mockResolvedValue({ id: mediaId, media_type: 'IMAGE' });
    await import('../src/instagram-first-publication-verify.js');
    expect(receipt()).toMatchObject({
      status: 'PUBLISHED',
      requestMediaType: 'STORY',
      permalink: null,
    });
  });

  it.each(['database', 'provider', 'cleanup'])(
    'fails closed on %s error without leaking provider or database details',
    async (stage) => {
      const error = new Error('private provider/database error detail');
      if (stage === 'database') database.query.mockRejectedValue(error);
      if (stage === 'provider') provider.get.mockRejectedValue(error);
      if (stage === 'cleanup') database.end.mockRejectedValue(error);
      await expectReconciliation();
      expect(output.join('')).not.toContain(error.message);
      expect(database.end).toHaveBeenCalledOnce();
      expect(database.query).toHaveBeenCalledOnce();
    },
  );
});
