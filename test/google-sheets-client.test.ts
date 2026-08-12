import { describe, expect, it } from 'vitest';
import type { SecretReference, SecretResolver } from '../src/core/secrets.js';
import { GoogleSheetsRestClient, type FetchLike } from '../src/providers/google-sheets/client.js';

class FakeSecretResolver implements SecretResolver {
  readonly references: SecretReference[] = [];

  resolve(reference: SecretReference): Promise<string> {
    this.references.push(reference);
    return Promise.resolve('secret-access-token');
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GoogleSheetsRestClient', () => {
  it('reads rows with an access token resolved through SecretResolver', async () => {
    const secrets = new FakeSecretResolver();
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: FetchLike = (input, init) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(jsonResponse({ values: [['SUN-0001', 96.5]] }));
    };
    const client = new GoogleSheetsRestClient(
      secrets,
      { tokenReference: { provider: 'runtime', key: 'google-sheets-access-token' } },
      fetcher,
    );

    const rows = await client.readRange('sheet-id', 'ASSET_INTELLIGENCE!A2:B10');

    expect(rows).toEqual([['SUN-0001', 96.5]]);
    expect(secrets.references).toEqual([
      { provider: 'runtime', key: 'google-sheets-access-token' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/spreadsheets/sheet-id/values/ASSET_INTELLIGENCE!A2%3AB10');
    expect(calls[0]?.url).toContain('valueRenderOption=UNFORMATTED_VALUE');
    expect(new Headers(calls[0]?.init?.headers).get('Authorization')).toBe(
      'Bearer secret-access-token',
    );
  });

  it('appends one row using USER_ENTERED semantics', async () => {
    const secrets = new FakeSecretResolver();
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: FetchLike = (input, init) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(jsonResponse({ updates: { updatedRows: 1 } }));
    };
    const client = new GoogleSheetsRestClient(
      secrets,
      { tokenReference: { provider: 'runtime', key: 'google-sheets-access-token' } },
      fetcher,
    );

    await client.appendRow('sheet-id', 'ASSET_USAGE_LOG!A:I', ['log-1', 'CONTENT-001']);

    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.url).toContain('valueInputOption=USER_ENTERED');
    expect(calls[0]?.url).toContain('insertDataOption=INSERT_ROWS');
    const body = calls[0]?.init?.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') throw new Error('Expected JSON request body');
    expect(JSON.parse(body)).toEqual({
      majorDimension: 'ROWS',
      values: [['log-1', 'CONTENT-001']],
    });
  });

  it('returns an empty matrix when the provider omits values', async () => {
    const client = new GoogleSheetsRestClient(
      new FakeSecretResolver(),
      { tokenReference: { provider: 'runtime', key: 'google-sheets-access-token' } },
      () => Promise.resolve(jsonResponse({ range: 'Sheet1!A1:B2' })),
    );

    await expect(client.readRange('sheet-id', 'Sheet1!A1:B2')).resolves.toEqual([]);
  });

  it('reports provider errors without exposing the access token', async () => {
    const client = new GoogleSheetsRestClient(
      new FakeSecretResolver(),
      { tokenReference: { provider: 'runtime', key: 'google-sheets-access-token' } },
      () => Promise.resolve(jsonResponse({ error: { message: 'Permission denied' } }, 403)),
    );

    await expect(client.readRange('sheet-id', 'Sheet1!A1')).rejects.toThrow(
      'Google Sheets read range failed with HTTP 403: Permission denied',
    );
    await expect(client.readRange('sheet-id', 'Sheet1!A1')).rejects.not.toThrow(
      /secret-access-token/,
    );
  });
});
