import { describe, expect, it } from 'vitest';
import {
  resolveMetaPageAccessToken,
  type MetaFetch,
} from '../src/ops/instagram-engagement-meta-auth.js';

const graphBaseUrl = 'https://graph.facebook.com';
const apiVersion = 'v24.0';
const expectedPageId = '306103746115875';

describe('resolveMetaPageAccessToken', () => {
  it('resolves the page token from /me/accounts when the root token is user-scoped', async () => {
    const fetchImpl: MetaFetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/v24.0/me/accounts');
      expect(url.searchParams.get('access_token')).toBe('root-token');
      return Response.json({
        data: [
          { id: 'other-page', access_token: 'other-token' },
          { id: expectedPageId, access_token: 'resolved-page-token' },
        ],
      });
    };

    await expect(
      resolveMetaPageAccessToken({
        rootToken: 'root-token',
        expectedPageId,
        graphBaseUrl,
        apiVersion,
        fetchImpl,
      }),
    ).resolves.toBe('resolved-page-token');
  });

  it('accepts the root token when it already proves the expected Page identity', async () => {
    let call = 0;
    const fetchImpl: MetaFetch = async (input) => {
      call += 1;
      const url = new URL(String(input));
      if (call === 1) {
        expect(url.pathname).toBe('/v24.0/me/accounts');
        return Response.json({ data: [] });
      }
      expect(url.pathname).toBe(`/v24.0/${expectedPageId}`);
      expect(url.searchParams.get('access_token')).toBe('page-token');
      return Response.json({ id: expectedPageId });
    };

    await expect(
      resolveMetaPageAccessToken({
        rootToken: 'page-token',
        expectedPageId,
        graphBaseUrl,
        apiVersion,
        fetchImpl,
      }),
    ).resolves.toBe('page-token');
    expect(call).toBe(2);
  });

  it('fails closed when fallback identity does not match the canonical Page', async () => {
    let call = 0;
    const fetchImpl: MetaFetch = async () => {
      call += 1;
      if (call === 1) return Response.json({ data: [] });
      return Response.json({ id: 'unexpected-page' });
    };

    await expect(
      resolveMetaPageAccessToken({
        rootToken: 'ambiguous-token',
        expectedPageId,
        graphBaseUrl,
        apiVersion,
        fetchImpl,
      }),
    ).rejects.toThrow('META_PAGE_ACCESS_TOKEN_RESOLUTION_ID_MISMATCH');
  });

  it('fails closed when neither account discovery nor Page verification is authorized', async () => {
    let call = 0;
    const fetchImpl: MetaFetch = async () => {
      call += 1;
      if (call === 1) return new Response('{}', { status: 403 });
      return new Response('{}', { status: 401 });
    };

    await expect(
      resolveMetaPageAccessToken({
        rootToken: 'invalid-token',
        expectedPageId,
        graphBaseUrl,
        apiVersion,
        fetchImpl,
      }),
    ).rejects.toThrow('META_PAGE_ACCESS_TOKEN_RESOLUTION_FAILED:401');
  });
});
