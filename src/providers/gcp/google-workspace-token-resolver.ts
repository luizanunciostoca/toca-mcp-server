import type { SecretReference, SecretResolver } from '../../core/secrets.js';

const DEFAULT_METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const DEFAULT_IAM_CREDENTIALS_BASE_URL = 'https://iamcredentials.googleapis.com/v1';
const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;

export const GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER = 'gcp-iam-scoped-token';
export const GOOGLE_SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export interface GcpGoogleWorkspaceTokenResolverOptions {
  readonly serviceAccountEmail: string;
  readonly scopes?: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly metadataTokenUrl?: string;
  readonly iamCredentialsBaseUrl?: string;
  readonly refreshSkewMs?: number;
  readonly now?: () => number;
}

interface MetadataTokenResponse {
  readonly access_token?: unknown;
}

interface GenerateAccessTokenResponse {
  readonly accessToken?: unknown;
  readonly expireTime?: unknown;
}

export class GcpGoogleWorkspaceTokenResolver implements SecretResolver {
  private readonly fetchImpl: typeof fetch;
  private readonly metadataTokenUrl: string;
  private readonly iamCredentialsBaseUrl: string;
  private readonly scopes: readonly string[];
  private readonly refreshSkewMs: number;
  private readonly now: () => number;
  private cachedToken: { readonly value: string; readonly refreshAt: number } | undefined;

  constructor(private readonly options: GcpGoogleWorkspaceTokenResolverOptions) {
    const email = options.serviceAccountEmail.trim();
    if (!email) throw new Error('GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL_REQUIRED');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.metadataTokenUrl = options.metadataTokenUrl ?? DEFAULT_METADATA_TOKEN_URL;
    this.iamCredentialsBaseUrl = (options.iamCredentialsBaseUrl ?? DEFAULT_IAM_CREDENTIALS_BASE_URL).replace(
      /\/$/,
      '',
    );
    this.scopes = options.scopes?.length ? [...new Set(options.scopes)] : [GOOGLE_SHEETS_READONLY_SCOPE];
    if (this.scopes.some((scope) => !scope.trim())) {
      throw new Error('GOOGLE_WORKSPACE_SCOPE_INVALID');
    }
    this.refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
    if (!Number.isInteger(this.refreshSkewMs) || this.refreshSkewMs < 0 || this.refreshSkewMs > 30 * 60 * 1000) {
      throw new Error('GOOGLE_WORKSPACE_REFRESH_SKEW_INVALID');
    }
    this.now = options.now ?? Date.now;
  }

  async resolve(reference: SecretReference): Promise<string> {
    if (reference.provider !== GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER) {
      throw new Error('GOOGLE_WORKSPACE_TOKEN_PROVIDER_MISMATCH');
    }
    return this.getAccessToken();
  }

  async getAccessToken(): Promise<string> {
    const now = this.now();
    if (this.cachedToken && this.cachedToken.refreshAt > now) return this.cachedToken.value;

    const metadataResponse = await this.fetchImpl(this.metadataTokenUrl, {
      headers: { 'Metadata-Flavor': 'Google' },
    });
    if (!metadataResponse.ok) {
      throw new Error(`GOOGLE_WORKSPACE_METADATA_TOKEN_FAILED:${metadataResponse.status}`);
    }
    const metadataPayload = (await metadataResponse.json()) as MetadataTokenResponse;
    if (typeof metadataPayload.access_token !== 'string' || !metadataPayload.access_token.trim()) {
      throw new Error('GOOGLE_WORKSPACE_METADATA_TOKEN_MISSING');
    }

    const serviceAccountEmail = this.options.serviceAccountEmail.trim();
    const endpoint = `${this.iamCredentialsBaseUrl}/projects/-/serviceAccounts/${encodeURIComponent(
      serviceAccountEmail,
    )}:generateAccessToken`;
    const tokenResponse = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${metadataPayload.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ scope: this.scopes, lifetime: '3600s' }),
    });
    if (!tokenResponse.ok) {
      throw new Error(`GOOGLE_WORKSPACE_SCOPED_TOKEN_FAILED:${tokenResponse.status}`);
    }
    const payload = (await tokenResponse.json()) as GenerateAccessTokenResponse;
    if (typeof payload.accessToken !== 'string' || !payload.accessToken.trim()) {
      throw new Error('GOOGLE_WORKSPACE_SCOPED_TOKEN_MISSING');
    }
    if (typeof payload.expireTime !== 'string') {
      throw new Error('GOOGLE_WORKSPACE_SCOPED_TOKEN_EXPIRY_MISSING');
    }
    const expiresAt = Date.parse(payload.expireTime);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      throw new Error('GOOGLE_WORKSPACE_SCOPED_TOKEN_EXPIRY_INVALID');
    }

    this.cachedToken = {
      value: payload.accessToken,
      refreshAt: Math.max(now, expiresAt - this.refreshSkewMs),
    };
    return payload.accessToken;
  }
}
