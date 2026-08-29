import { describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER,
  GcpGoogleWorkspaceTokenResolver,
} from '../src/providers/gcp/google-workspace-token-resolver.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GcpGoogleWorkspaceTokenResolver', () => {
  it('exchanges the Cloud Run metadata token for a scoped Google Sheets token', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'metadata-token' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: 'sheets-token',
          expireTime: '2026-08-28T21:00:00.000Z',
        }),
      );
    const resolver = new GcpGoogleWorkspaceTokenResolver({
      serviceAccountEmail: 'runtime@example.iam.gserviceaccount.com',
      fetchImpl,
      now: () => Date.parse('2026-08-28T20:00:00.000Z'),
    });

    await expect(
      resolver.resolve({
        provider: GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER,
        key: 'sheets-readonly',
      }),
    ).resolves.toBe('sheets-token');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, iamInit] = fetchImpl.mock.calls[1] ?? [];
    expect(iamInit?.method).toBe('POST');
    expect(iamInit?.headers).toMatchObject({ Authorization: 'Bearer metadata-token' });
    const iamBody = iamInit?.body;
    if (typeof iamBody !== 'string') throw new Error('EXPECTED_STRING_IAM_REQUEST_BODY');
    expect(JSON.parse(iamBody)).toEqual({
      scope: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      lifetime: '3600s',
    });
  });

  it('reuses a scoped token until the refresh window is reached', async () => {
    let now = Date.parse('2026-08-28T20:00:00.000Z');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'metadata-token-1' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: 'sheets-token-1',
          expireTime: '2026-08-28T21:00:00.000Z',
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'metadata-token-2' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: 'sheets-token-2',
          expireTime: '2026-08-28T22:00:00.000Z',
        }),
      );
    const resolver = new GcpGoogleWorkspaceTokenResolver({
      serviceAccountEmail: 'runtime@example.iam.gserviceaccount.com',
      fetchImpl,
      now: () => now,
    });
    const reference = { provider: GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER, key: 'sheets-readonly' };

    await expect(resolver.resolve(reference)).resolves.toBe('sheets-token-1');
    now = Date.parse('2026-08-28T20:50:00.000Z');
    await expect(resolver.resolve(reference)).resolves.toBe('sheets-token-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    now = Date.parse('2026-08-28T20:56:00.000Z');
    await expect(resolver.resolve(reference)).resolves.toBe('sheets-token-2');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('fails closed on provider mismatch or IAM exchange failure', async () => {
    const resolver = new GcpGoogleWorkspaceTokenResolver({
      serviceAccountEmail: 'runtime@example.iam.gserviceaccount.com',
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(200, { access_token: 'metadata-token' }))
        .mockResolvedValueOnce(jsonResponse(403, { error: 'forbidden' })),
    });

    await expect(resolver.resolve({ provider: 'env', key: 'token' })).rejects.toThrow(
      'GOOGLE_WORKSPACE_TOKEN_PROVIDER_MISMATCH',
    );
    await expect(
      resolver.resolve({
        provider: GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER,
        key: 'sheets-readonly',
      }),
    ).rejects.toThrow('GOOGLE_WORKSPACE_SCOPED_TOKEN_FAILED:403');
  });
});
