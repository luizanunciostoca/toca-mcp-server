import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

// Keep the real config and Meta GET client, but never acquire actual credentials.
vi.mock('../src/core/gcp-secret-manager-store.js', () => ({
  GcpSecretManagerStore: class {
    resolve() {
      return Promise.resolve('offline-test-token');
    }
  },
}));

const now = '2026-10-21T12:00:00Z';
const bytes = 'expected-image-bytes';
const expectedHash = createHash('sha256').update(bytes).digest('hex');
const mediaUrl = 'https://media.example.test/image.jpg';
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let output: MockInstance<typeof process.stdout.write>;
const originalExitCode = process.exitCode;

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'publication-1',
    timestamp: now,
    media_type: 'IMAGE',
    media_url: mediaUrl,
    caption: 'A distinct caption',
    ...overrides,
  };
}

function fetchUrl(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : input.toString();
}

function provider(payload: unknown, media = 'different-bytes') {
  fetchMock.mockImplementation((input) => {
    if (fetchUrl(input).startsWith('https://graph.facebook.com/')) {
      return Promise.resolve(Response.json(payload));
    }
    if (fetchUrl(input) === mediaUrl) return Promise.resolve(new Response(media));
    throw new Error('UNEXPECTED_OFFLINE_FETCH');
  });
}

async function run() {
  await import('../src/instagram-provider-duplicate-preflight.js');
}

function evidence(): Record<string, unknown> {
  const line = output.mock.calls
    .map((call) => String(call[0]))
    .find((value) => value.startsWith('INSTAGRAM_DUPLICATE_PREFLIGHT_RESULT='));
  expect(line).toBeDefined();
  return JSON.parse(line!.slice('INSTAGRAM_DUPLICATE_PREFLIGHT_RESULT='.length)) as Record<
    string,
    unknown
  >;
}

function noEvidence() {
  expect(
    output.mock.calls.some((call) =>
      String(call[0]).startsWith('INSTAGRAM_DUPLICATE_PREFLIGHT_RESULT='),
    ),
  ).toBe(false);
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now));
  for (const [key, value] of Object.entries({
    META_ENABLED: 'true',
    META_APP_ID: 'offline-app',
    META_APP_SECRET_PROVIDER: 'gcp-secret-manager',
    META_APP_SECRET_KEY: 'offline-key',
    META_AUTHORIZATION_ENDPOINT: 'https://example.test/auth',
    META_TOKEN_ENDPOINT: 'https://example.test/token',
    META_REDIRECT_URI: 'https://example.test/callback',
    META_REQUESTED_SCOPES: 'instagram_basic',
    DATABASE_URL: 'postgresql://offline.invalid/test',
    META_ACCESS_TOKEN_ENV_KEY: 'OFFLINE_TOKEN',
    OFFLINE_TOKEN: 'offline-unused-token',
    META_TOKEN_STORE_PROVIDER: 'gcp-secret-manager',
    META_TOKEN_SECRET_ID: 'offline-secret',
    GCP_PROJECT_ID: 'offline-project',
    INSTAGRAM_PUBLICATION_WRITES_ENABLED: 'false',
    INSTAGRAM_BUSINESS_ACCOUNT_ID: 'account-123',
    INSTAGRAM_DUPLICATE_PREFLIGHT_CONTENT_ITEM_ID: 'content-123',
    INSTAGRAM_DUPLICATE_PREFLIGHT_FORMAT: 'FEED_IMAGE',
    INSTAGRAM_DUPLICATE_PREFLIGHT_EXPECTED_ASSET_SHA256: expectedHash,
    INSTAGRAM_DUPLICATE_PREFLIGHT_SCHEDULED_AT: now,
    INSTAGRAM_DUPLICATE_PREFLIGHT_CAPTION_BASE64: Buffer.from('Olá mundo').toString('base64'),
  }))
    vi.stubEnv(key, value);
  fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('UNEXPECTED_OFFLINE_FETCH'));
  vi.stubGlobal('fetch', fetchMock);
  output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Instagram duplicate preflight fail-closed coverage', () => {
  it('clears a complete empty response and preserves account, GET, token and evidence contract', async () => {
    provider({ data: [] });
    await run();
    expect(evidence()).toMatchObject({
      schemaVersion: 1,
      contentItemId: 'content-123',
      instagramAccountId: 'account-123',
      format: 'FEED_IMAGE',
      providerReadOnly: true,
      expectedAssetSha256: expectedHash,
      duplicateFound: false,
      duplicatePublicationId: null,
      duplicatePermalink: null,
      duplicateAssetSha256: null,
      duplicateReason: null,
      inspectedMediaCount: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(fetchUrl(url)).pathname).toBe('/v24.0/account-123/media');
    expect(new URL(fetchUrl(url)).searchParams.get('limit')).toBe('100');
    expect(init).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer offline-test-token' },
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('clears a distinct complete page with valid terminal cursors', async () => {
    provider({
      data: [item()],
      paging: { cursors: { before: 'a', after: 'b' } },
    });
    await run();
    expect(evidence()).toMatchObject({
      duplicateFound: false,
      inspectedMediaCount: 1,
    });
    expect(fetchMock.mock.calls[1]![1]).toEqual({
      method: 'GET',
      redirect: 'follow',
    });
  });

  it.each([
    { next: 'https://evil.example.test/steal?access_token=not-real' },
    { next: null },
    { previous: 'previous-page' },
    null,
    [],
    'bad',
    { has_more: true },
    { cursors: null },
    { cursors: { after: 10 } },
  ])('never clears uncertain paging %j or follows a continuation', async (paging) => {
    provider({ data: [item()], paging });
    await expect(run()).rejects.toThrow(/PROVIDER_(COVERAGE_INCOMPLETE|PAGING_INVALID)/);
    noEvidence();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects array envelopes, array records, and array paging rather than dropping them', async () => {
    for (const payload of [[], { data: [[]] }, { data: [], paging: [] }]) {
      vi.resetModules();
      provider(payload);
      await expect(run()).rejects.toThrow(/PROVIDER_(RESPONSE|ITEM|PAGING)_INVALID/);
      noEvidence();
    }
  });

  it('blocks a saturated page without assuming that old rows imply chronological coverage', async () => {
    provider({
      data: Array.from({ length: 100 }, (_, i) =>
        item({ id: `${i}`, timestamp: '2020-01-01T00:00:00Z' }),
      ),
    });
    await expect(run()).rejects.toThrow('PROVIDER_COVERAGE_INCOMPLETE');
    noEvidence();
  });

  it.each([
    null,
    [],
    'row',
    5,
    {},
    item({ id: '' }),
    item({ id: ' ' }),
    item({ caption: null }),
    item({ media_url: 42 }),
    item({ media_type: null }),
    item({ permalink: [] }),
  ])('rejects every malformed record, even after a match: %j', async (bad) => {
    provider({ data: [item(), bad] }, bytes);
    await expect(run()).rejects.toThrow(/PROVIDER_(ITEM|ID|TIMESTAMP)_INVALID/);
    noEvidence();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    null,
    10,
    'not-a-time',
    '2026-02-30T12:00:00Z',
    '2026-10-21T24:00:00Z',
    '2026-10-21T12:00:00',
    '2026-10-22T12:00:00Z',
  ])('rejects uncertain timestamps %j', async (timestamp) => {
    provider({ data: [item({ timestamp })] });
    await expect(run()).rejects.toThrow('PROVIDER_TIMESTAMP_INVALID');
    noEvidence();
  });

  it('does not assume ordering when an old row precedes a recent duplicate', async () => {
    provider(
      {
        data: [item({ id: 'old', timestamp: '2020-01-01T00:00:00Z' }), item()],
      },
      bytes,
    );
    await run();
    expect(evidence()).toMatchObject({
      duplicateFound: true,
      duplicatePublicationId: 'publication-1',
      inspectedMediaCount: 1,
    });
  });

  it('detects normalized captions independently of different asset bytes', async () => {
    provider({ data: [item({ caption: '  Ola\u0301\n  mundo  ' })] });
    await run();
    expect(evidence()).toMatchObject({
      duplicateFound: true,
      duplicateReason: 'NORMALIZED_CAPTION_MATCH',
      duplicateAssetSha256: null,
    });
    expect(process.exitCode).toBe(2);
  });

  it('detects exact asset SHA regardless of caption', async () => {
    provider({ data: [item()] }, bytes);
    await run();
    expect(evidence()).toMatchObject({
      duplicateFound: true,
      duplicateReason: 'EXACT_ASSET_SHA256_MATCH',
      duplicateAssetSha256: expectedHash,
    });
    expect(process.exitCode).toBe(2);
  });

  it('preserves duplicate blocking when matching caption has no media URL', async () => {
    const record = item({ caption: 'Olá mundo' });
    delete (record as Record<string, unknown>).media_url;
    provider({ data: [record] });
    await run();
    expect(evidence()).toMatchObject({
      duplicateFound: true,
      duplicateReason: 'EXACT_CAPTION_MATCH_WITHOUT_MEDIA_URL',
    });
  });

  it('does not treat a matching caption as sufficient for stories', async () => {
    vi.stubEnv('INSTAGRAM_DUPLICATE_PREFLIGHT_FORMAT', 'STORY_IMAGE');
    provider({ data: [item({ caption: 'Olá mundo' })] });
    await run();
    expect(evidence()).toMatchObject({
      duplicateFound: false,
      format: 'STORY_IMAGE',
    });
    expect(new URL(fetchUrl(fetchMock.mock.calls[0]![0])).pathname).toBe(
      '/v24.0/account-123/stories',
    );
  });

  it.each([
    '',
    'not-a-url',
    'http://media.example.test/image.jpg',
    'https://user:password@media.example.test/image.jpg',
  ])('fails closed on unusable media %j', async (media_url) => {
    provider({ data: [item({ media_url })] });
    await expect(run()).rejects.toThrow(/MEDIA_URL_(INVALID|MISSING)/);
    noEvidence();
  });

  it.each([null, [], {}, { data: null }, { data: [], error: {} }])(
    'rejects malformed provider responses %j',
    async (payload) => {
      provider(payload);
      await expect(run()).rejects.toThrow(/PROVIDER_(RESPONSE|DATA)_INVALID/);
      noEvidence();
    },
  );

  it.each(['network', 'http', 'empty', 'body'])(
    'fails closed on media %s failures',
    async (failure) => {
      provider({ data: [item()] });
      const graph = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (input, init) => {
        if (fetchUrl(input) !== mediaUrl) return graph(input, init);
        if (failure === 'network') throw new Error('offline network failure');
        if (failure === 'http') return new Response('unavailable', { status: 503 });
        if (failure === 'body')
          return {
            ok: true,
            arrayBuffer: () => Promise.reject(new Error('offline body failure')),
          } as unknown as Response;
        return new Response('');
      });
      await expect(run()).rejects.toThrow();
      noEvidence();
    },
  );

  it.each(['network', 'http', 'json'])('fails closed on provider %s failures', async (failure) => {
    fetchMock.mockImplementation(() => {
      if (failure === 'network') throw new Error('offline provider failure');
      return Promise.resolve(new Response('not json', { status: failure === 'http' ? 503 : 200 }));
    });
    await expect(run()).rejects.toThrow();
    noEvidence();
  });

  it.each([
    ['INSTAGRAM_PUBLICATION_WRITES_ENABLED', 'true', 'WRITES_MUST_BE_DISABLED'],
    ['META_ENABLED', 'false', 'META_ENABLED_REQUIRED'],
    ['META_TOKEN_STORE_PROVIDER', 'memory', 'TOKEN_STORE_MUST_BE_GCP_SECRET_MANAGER'],
    ['INSTAGRAM_DUPLICATE_PREFLIGHT_SCHEDULED_AT', '2026-02-30T12:00:00Z', 'SCHEDULE_INVALID'],
  ])('rejects unsafe configuration %s before any fetch', async (key, value, error) => {
    vi.stubEnv(key, value);
    await expect(run()).rejects.toThrow(error);
    noEvidence();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
