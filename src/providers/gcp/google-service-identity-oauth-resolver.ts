import { ExecutionError } from '../../core/errors.js';
import type { SecretReference, SecretResolver } from '../../core/secrets.js';

const DEFAULT_METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const DEFAULT_METADATA_EMAIL_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email';
const DEFAULT_IAM_CREDENTIALS_BASE_URL = 'https://iamcredentials.googleapis.com/v1';
const DEFAULT_GOOGLE_OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const SCOPE_SETS = {
  'video-workspace': [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
  ],
} as const;

type GoogleServiceIdentityScopeSet = keyof typeof SCOPE_SETS;

interface CachedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

export interface GoogleServiceIdentityOAuthResolverOptions {
  readonly fetchImpl?: typeof fetch;
  readonly metadataTokenUrl?: string;
  readonly metadataEmailUrl?: string;
  readonly iamCredentialsBaseUrl?: string;
  readonly tokenEndpoint?: string;
  readonly now?: () => number;
}

export class GoogleServiceIdentityOAuthResolver implements SecretResolver {
  private readonly fetchImpl: typeof fetch;
  private readonly metadataTokenUrl: string;
  private readonly metadataEmailUrl: string;
  private readonly iamCredentialsBaseUrl: string;
  private readonly tokenEndpoint: string;
  private readonly now: () => number;
  private readonly cache = new Map<GoogleServiceIdentityScopeSet, CachedToken>();

  constructor(private readonly options: GoogleServiceIdentityOAuthResolverOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.metadataTokenUrl = options.metadataTokenUrl ?? DEFAULT_METADATA_TOKEN_URL;
    this.metadataEmailUrl = options.metadataEmailUrl ?? DEFAULT_METADATA_EMAIL_URL;
    this.iamCredentialsBaseUrl = (
      options.iamCredentialsBaseUrl ?? DEFAULT_IAM_CREDENTIALS_BASE_URL
    ).replace(/\/$/, '');
    this.tokenEndpoint = options.tokenEndpoint ?? DEFAULT_GOOGLE_OAUTH_TOKEN_ENDPOINT;
    this.now = options.now ?? Date.now;
  }

  async resolve(reference: SecretReference): Promise<string> {
    if (reference.provider !== 'gcp-service-identity-oauth' || !(reference.key in SCOPE_SETS)) {
      throw new Error('GCP_SERVICE_IDENTITY_OAUTH_REFERENCE_INVALID');
    }
    const scopeSet = reference.key as GoogleServiceIdentityScopeSet;
    const cached = this.cache.get(scopeSet);
    const nowMs = this.now();
    if (cached && cached.expiresAtMs - 60_000 > nowMs) return cached.token;

    const [metadataToken, serviceAccountEmail] = await Promise.all([
      this.fetchMetadataAccessToken(),
      this.fetchServiceAccountEmail(),
    ]);
    const issuedAt = Math.floor(nowMs / 1_000);
    const unsignedJwt = `${base64UrlJson({ alg: 'RS256', typ: 'JWT' })}.${base64UrlJson({
      iss: serviceAccountEmail,
      scope: SCOPE_SETS[scopeSet].join(' '),
      aud: this.tokenEndpoint,
      iat: issuedAt,
      exp: issuedAt + 3_600,
    })}`;
    const signature = await this.signBlob(serviceAccountEmail, metadataToken, unsignedJwt);
    const assertion = `${unsignedJwt}.${base64Url(Buffer.from(signature, 'base64'))}`;
    const token = await this.exchangeAssertion(assertion);
    this.cache.set(scopeSet, {
      token: token.accessToken,
      expiresAtMs: nowMs + token.expiresInSeconds * 1_000,
    });
    return token.accessToken;
  }

  private async fetchMetadataAccessToken(): Promise<string> {
    const response = await this.fetchImpl(this.metadataTokenUrl, {
      method: 'GET',
      headers: { 'Metadata-Flavor': 'Google' },
    });
    if (!response.ok) {
      throw providerError('GCP_SERVICE_IDENTITY_METADATA_TOKEN_FAILED', response.status);
    }
    const payload = (await response.json()) as { access_token?: unknown };
    if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        'GCP_SERVICE_IDENTITY_METADATA_TOKEN_INVALID',
        false,
      );
    }
    return payload.access_token.trim();
  }

  private async fetchServiceAccountEmail(): Promise<string> {
    const response = await this.fetchImpl(this.metadataEmailUrl, {
      method: 'GET',
      headers: { 'Metadata-Flavor': 'Google' },
    });
    if (!response.ok) {
      throw providerError('GCP_SERVICE_IDENTITY_METADATA_EMAIL_FAILED', response.status);
    }
    const email = (await response.text()).trim();
    if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(email)) {
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        'GCP_SERVICE_IDENTITY_METADATA_EMAIL_INVALID',
        false,
      );
    }
    return email;
  }

  private async signBlob(
    serviceAccountEmail: string,
    metadataToken: string,
    unsignedJwt: string,
  ): Promise<string> {
    const response = await this.fetchImpl(
      `${this.iamCredentialsBaseUrl}/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:signBlob`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${metadataToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ payload: Buffer.from(unsignedJwt).toString('base64') }),
      },
    );
    if (!response.ok) {
      throw providerError('GCP_SERVICE_IDENTITY_SIGN_BLOB_FAILED', response.status);
    }
    const payload = (await response.json()) as { signedBlob?: unknown };
    if (typeof payload.signedBlob !== 'string' || !payload.signedBlob.trim()) {
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        'GCP_SERVICE_IDENTITY_SIGN_BLOB_INVALID',
        false,
      );
    }
    return payload.signedBlob.trim();
  }

  private async exchangeAssertion(
    assertion: string,
  ): Promise<{ readonly accessToken: string; readonly expiresInSeconds: number }> {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });
    const response = await this.fetchImpl(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw providerError('GCP_SERVICE_IDENTITY_OAUTH_EXCHANGE_FAILED', response.status);
    }
    const payload = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
      token_type?: unknown;
    };
    if (
      typeof payload.access_token !== 'string' ||
      !payload.access_token.trim() ||
      typeof payload.expires_in !== 'number' ||
      !Number.isFinite(payload.expires_in) ||
      payload.expires_in <= 0 ||
      payload.token_type !== 'Bearer'
    ) {
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        'GCP_SERVICE_IDENTITY_OAUTH_RESPONSE_INVALID',
        false,
      );
    }
    return {
      accessToken: payload.access_token.trim(),
      expiresInSeconds: payload.expires_in,
    };
  }
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function providerError(prefix: string, status: number): ExecutionError {
  return new ExecutionError(
    status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
    `${prefix}:${status}`,
    status === 429 || status >= 500,
  );
}
