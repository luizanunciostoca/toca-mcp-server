import { generateKeyPairSync, sign } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  OidcVerificationError,
  createOidcAppGatewayAuthorize,
  createOidcBearerVerifier,
  type OidcJwksTransport,
  type OidcVerificationErrorCode,
  type VerifiedOidcIdentity,
} from '../src/app-gateway/oidc-verifier.js';

const ISSUER = 'https://identity.example.test/';
const AUDIENCE = 'toca-android';
const JWKS_URI = 'https://identity.example.test/.well-known/jwks.json';
const NOW = 2_000_000_000;

interface SigningFixture {
  readonly privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  readonly jwk: Record<string, unknown>;
  readonly kid: string;
}

function signingFixture(kid = 'key-1'): SigningFixture {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const exported = publicKey.export({ format: 'jwk' });
  return {
    privateKey,
    kid,
    jwk: {
      ...exported,
      kid,
      alg: 'RS256',
      use: 'sig',
      key_ops: ['verify'],
    },
  };
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function createJwt(
  fixture: SigningFixture,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): string {
  const encodedHeader = encodeJson({ alg: 'RS256', typ: 'JWT', kid: fixture.kid, ...header });
  const encodedClaims = encodeJson({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'user-123',
    exp: NOW + 300,
    ...claims,
  });
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput, 'ascii'), fixture.privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function transportFor(
  keys: readonly Record<string, unknown>[],
): ReturnType<typeof vi.fn<OidcJwksTransport>> {
  return vi.fn<OidcJwksTransport>(async () => JSON.stringify({ keys }));
}

function verifierFor(
  fixture: SigningFixture,
  overrides: Partial<Parameters<typeof createOidcBearerVerifier>[0]> = {},
) {
  return createOidcBearerVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri: JWKS_URI,
    transport: transportFor([fixture.jwk]),
    nowEpochSeconds: () => NOW,
    clockSkewSeconds: 0,
    ...overrides,
  });
}

async function expectCode(
  promise: Promise<unknown>,
  code: OidcVerificationErrorCode,
): Promise<void> {
  await expect(promise).rejects.toEqual(expect.objectContaining({ code }));
}

describe('App Gateway OIDC bearer verifier', () => {
  it('verifies an RS256 token and exposes only bounded verified identity fields', async () => {
    const fixture = signingFixture();
    const identity = await verifierFor(fixture).verify(
      createJwt(fixture, { roles: ['ADMIN'], tenant: 'attacker-controlled' }),
    );

    expect(identity).toEqual({
      subject: 'user-123',
      issuer: ISSUER,
      audiences: [AUDIENCE],
      expiresAt: NOW + 300,
    });
    expect('roles' in identity).toBe(false);
    expect('tenant' in identity).toBe(false);
  });

  it('rejects malformed, oversized and unsupported-algorithm tokens', async () => {
    const fixture = signingFixture();
    const verifier = verifierFor(fixture, { maximumTokenBytes: 512 });

    await expectCode(verifier.verify('not-a-jwt'), 'OIDC_TOKEN_MALFORMED');
    await expectCode(verifier.verify('x'.repeat(513)), 'OIDC_TOKEN_TOO_LARGE');
    await expectCode(
      verifier.verify(createJwt(fixture, {}, { alg: 'HS256' })),
      'OIDC_ALGORITHM_REJECTED',
    );
    await expectCode(verifier.verify(createJwt(fixture, {}, { kid: '' })), 'OIDC_KID_REQUIRED');
    await expectCode(
      verifier.verify(createJwt(fixture, {}, { jku: 'https://attacker.example/jwks' })),
      'OIDC_HEADER_UNSUPPORTED',
    );
  });

  it('rejects unknown keys, invalid signatures and invalid RSA key metadata', async () => {
    const fixture = signingFixture();
    const other = signingFixture('other-key');

    await expectCode(verifierFor(fixture).verify(createJwt(other)), 'OIDC_KEY_NOT_FOUND');

    const wrongSignature = createJwt(fixture).split('.');
    const attackerSignature = createJwt(other).split('.')[2];
    expect(wrongSignature).toHaveLength(3);
    expect(attackerSignature).toBeTruthy();
    wrongSignature[2] = attackerSignature;
    await expectCode(
      verifierFor(fixture).verify(wrongSignature.join('.')),
      'OIDC_SIGNATURE_INVALID',
    );

    const badJwk = { ...fixture.jwk, use: 'enc' };
    await expectCode(
      verifierFor(fixture, { transport: transportFor([badJwk]) }).verify(createJwt(fixture)),
      'OIDC_KEY_INVALID',
    );
  });

  it('validates exact issuer, expected audience, exp, nbf and subject', async () => {
    const fixture = signingFixture();
    const verifier = verifierFor(fixture);

    await expectCode(
      verifier.verify(createJwt(fixture, { iss: 'https://wrong.example/' })),
      'OIDC_ISSUER_MISMATCH',
    );
    await expectCode(
      verifier.verify(createJwt(fixture, { aud: 'wrong-audience' })),
      'OIDC_AUDIENCE_MISMATCH',
    );
    await expectCode(verifier.verify(createJwt(fixture, { exp: NOW })), 'OIDC_TOKEN_EXPIRED');
    await expectCode(
      verifier.verify(createJwt(fixture, { nbf: NOW + 1 })),
      'OIDC_TOKEN_NOT_ACTIVE',
    );
    await expectCode(verifier.verify(createJwt(fixture, { sub: '   ' })), 'OIDC_SUBJECT_REQUIRED');

    const arrayAudience = await verifier.verify(
      createJwt(fixture, { aud: ['other-audience', AUDIENCE] }),
    );
    expect(arrayAudience.audiences).toEqual(['other-audience', AUDIENCE]);
  });

  it('requires an explicitly configured HTTPS JWKS URI and bounded configuration', () => {
    const fixture = signingFixture();

    expect(() =>
      createOidcBearerVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: 'http://identity.example.test/jwks.json',
        transport: transportFor([fixture.jwk]),
      }),
    ).toThrowError(expect.objectContaining({ code: 'OIDC_CONFIGURATION_INVALID' }));

    expect(() =>
      createOidcBearerVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: JWKS_URI,
        clockSkewSeconds: 301,
        transport: transportFor([fixture.jwk]),
      }),
    ).toThrowError(expect.objectContaining({ code: 'OIDC_CONFIGURATION_INVALID' }));
  });

  it('bounds JWKS payloads and fails closed when the transport fails', async () => {
    const fixture = signingFixture();
    const token = createJwt(fixture);

    await expectCode(
      verifierFor(fixture, {
        maximumJwksBytes: 32,
        transport: async () => JSON.stringify({ keys: [fixture.jwk] }),
      }).verify(token),
      'OIDC_JWKS_TOO_LARGE',
    );

    await expectCode(
      verifierFor(fixture, {
        transport: async () => {
          throw new Error('network details that must not escape');
        },
      }).verify(token),
      'OIDC_JWKS_FETCH_FAILED',
    );
  });

  it('caches JWKS and refreshes once on an unknown kid', async () => {
    const first = signingFixture('first');
    const rotated = signingFixture('rotated');
    let calls = 0;
    const transport: OidcJwksTransport = async () => {
      calls += 1;
      return JSON.stringify({ keys: calls === 1 ? [first.jwk] : [rotated.jwk] });
    };
    const verifier = verifierFor(first, {
      transport,
      jwksCacheTtlMs: 60_000,
    });

    await verifier.verify(createJwt(first));
    await verifier.verify(createJwt(first));
    expect(calls).toBe(1);

    await verifier.verify(createJwt(rotated));
    expect(calls).toBe(2);
  });

  it('creates a fail-closed App Gateway authorizer with server-side principal mapping', async () => {
    const fixture = signingFixture();
    const transport = transportFor([fixture.jwk]);
    const failures: OidcVerificationErrorCode[] = [];
    let mappedIdentity: VerifiedOidcIdentity | undefined;
    const authorize = createOidcAppGatewayAuthorize({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: JWKS_URI,
      transport,
      nowEpochSeconds: () => NOW,
      clockSkewSeconds: 0,
      mapPrincipal: (identity) => {
        mappedIdentity = identity;
        return identity.subject === 'user-123'
          ? { subject: 'mapped:user-123', tenantId: 'toca-do-morcego', roles: ['APP_USER'] }
          : undefined;
      },
      onFailure: (code) => failures.push(code),
    });

    const token = createJwt(fixture, { roles: ['EXECUTE_ANYTHING'] });
    const request = { headers: { authorization: `Bearer ${token}` } } as IncomingMessage;
    await expect(authorize(request)).resolves.toEqual({
      subject: 'mapped:user-123',
      tenantId: 'toca-do-morcego',
      roles: ['APP_USER'],
    });
    expect(mappedIdentity).toEqual({
      subject: 'user-123',
      issuer: ISSUER,
      audiences: [AUDIENCE],
      expiresAt: NOW + 300,
    });
    expect(failures).toEqual([]);

    await expect(authorize({ headers: {} } as IncomingMessage)).resolves.toBeUndefined();
    expect(failures.at(-1)).toBe('OIDC_BEARER_MISSING');
  });

  it('does not leak mapper exceptions through authorization', async () => {
    const fixture = signingFixture();
    const failures: OidcVerificationErrorCode[] = [];
    const authorize = createOidcAppGatewayAuthorize({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: JWKS_URI,
      transport: transportFor([fixture.jwk]),
      nowEpochSeconds: () => NOW,
      clockSkewSeconds: 0,
      mapPrincipal: () => {
        throw new Error('sensitive mapper internals');
      },
      onFailure: (code) => failures.push(code),
    });
    const request = {
      headers: { authorization: `Bearer ${createJwt(fixture)}` },
    } as IncomingMessage;

    await expect(authorize(request)).resolves.toBeUndefined();
    expect(failures).toEqual(['OIDC_PRINCIPAL_MAPPING_FAILED']);
  });

  it('exposes only safe verification error codes', () => {
    const error = new OidcVerificationError('OIDC_SIGNATURE_INVALID');
    expect(error.message).toBe('OIDC_SIGNATURE_INVALID');
    expect(error.code).toBe('OIDC_SIGNATURE_INVALID');
  });
});
