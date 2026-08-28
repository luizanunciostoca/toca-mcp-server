import type { SecretReference, SecretResolver } from '../core/secrets.js';

export const AG01_GCP_METADATA_REFERENCE_KEY = '__ag01_gcp_metadata__';
const DEFAULT_METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const DEFAULT_METADATA_EMAIL_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email';
const DEFAULT_IAM_CREDENTIALS_BASE_URL = 'https://iamcredentials.googleapis.com/v1';
const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

interface GoogleOAuthRefreshOptions {
  readonly clientIdReference: SecretReference;
  readonly clientSecretReference: SecretReference;
  readonly refreshTokenReference: SecretReference;
  readonly secrets: SecretResolver;
  readonly tokenEndpoint?: string;
  readonly metadataTokenEndpoint?: string;
  readonly metadataEmailEndpoint?: string;
  readonly iamCredentialsBaseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => Date;
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly expires_in?: unknown;
  readonly token_type?: unknown;
}

interface IamCredentialsTokenResponse {
  readonly accessToken?: unknown;
  readonly expireTime?: unknown;
}

export class GoogleOAuthRefreshSecretResolver implements SecretResolver {
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #tokenEndpoint: string;
  readonly #metadataTokenEndpoint: string;
  readonly #metadataEmailEndpoint: string;
  readonly #iamCredentialsBaseUrl: string;
  readonly #timeoutMs: number;
  #cache: { readonly token: string; readonly expiresAtMs: number } | undefined;
  #inFlight: Promise<string> | undefined;

  constructor(private readonly options: GoogleOAuthRefreshOptions) {
    this.#fetch = options.fetchFn ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#tokenEndpoint = options.tokenEndpoint ?? 'https://oauth2.googleapis.com/token';
    this.#metadataTokenEndpoint = options.metadataTokenEndpoint ?? DEFAULT_METADATA_TOKEN_URL;
    this.#metadataEmailEndpoint = options.metadataEmailEndpoint ?? DEFAULT_METADATA_EMAIL_URL;
    this.#iamCredentialsBaseUrl = (
      options.iamCredentialsBaseUrl ?? DEFAULT_IAM_CREDENTIALS_BASE_URL
    ).replace(/\/$/, '');
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  resolve(reference: SecretReference): Promise<string> {
    if (reference.provider !== 'google-oauth') {
      return Promise.reject(new Error(`Unsupported secret provider: ${reference.provider}`));
    }
    if (reference.key !== 'sheets-readonly') {
      return Promise.reject(new Error(`Unsupported Google OAuth token purpose: ${reference.key}`));
    }
    return this.#accessToken();
  }

  async #accessToken(): Promise<string> {
    const nowMs = this.#now().getTime();
    if (this.#cache && this.#cache.expiresAtMs - 60_000 > nowMs) return this.#cache.token;
    if (this.#inFlight) return this.#inFlight;
    const refresh = this.#usesGcpMetadata() ? this.#metadataSheetsToken() : this.#refresh();
    this.#inFlight = refresh;
    try {
      return await refresh;
    } finally {
      if (this.#inFlight === refresh) this.#inFlight = undefined;
    }
  }

  #usesGcpMetadata(): boolean {
    return [
      this.options.clientIdReference,
      this.options.clientSecretReference,
      this.options.refreshTokenReference,
    ].every(
      (reference) =>
        reference.provider === 'env' && reference.key === AG01_GCP_METADATA_REFERENCE_KEY,
    );
  }

  async #metadataSheetsToken(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const [metadataTokenResponse, emailResponse] = await Promise.all([
        this.#fetch(this.#metadataTokenEndpoint, {
          headers: { 'Metadata-Flavor': 'Google', accept: 'application/json' },
          signal: controller.signal,
        }),
        this.#fetch(this.#metadataEmailEndpoint, {
          headers: { 'Metadata-Flavor': 'Google', accept: 'text/plain' },
          signal: controller.signal,
        }),
      ]);
      if (!metadataTokenResponse.ok) {
        throw new Error(`AG01_GCP_METADATA_TOKEN_FAILED:${metadataTokenResponse.status}`);
      }
      if (!emailResponse.ok) {
        throw new Error(`AG01_GCP_METADATA_EMAIL_FAILED:${emailResponse.status}`);
      }
      const metadataPayload = (await metadataTokenResponse.json()) as TokenResponse;
      if (
        typeof metadataPayload.access_token !== 'string' ||
        !metadataPayload.access_token.trim()
      ) {
        throw new Error('AG01_GCP_METADATA_ACCESS_TOKEN_MISSING');
      }
      const serviceAccountEmail = (await emailResponse.text()).trim();
      if (!serviceAccountEmail || !serviceAccountEmail.includes('@')) {
        throw new Error('AG01_GCP_METADATA_SERVICE_ACCOUNT_EMAIL_MISSING');
      }
      const endpoint = `${this.#iamCredentialsBaseUrl}/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:generateAccessToken`;
      const scopedResponse = await this.#fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${metadataPayload.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({ scope: [SHEETS_READONLY_SCOPE], lifetime: '3600s' }),
      });
      if (!scopedResponse.ok) {
        throw new Error(`AG01_GCP_SHEETS_TOKEN_FAILED:${scopedResponse.status}`);
      }
      const scopedPayload = (await scopedResponse.json()) as IamCredentialsTokenResponse;
      if (typeof scopedPayload.accessToken !== 'string' || !scopedPayload.accessToken.trim()) {
        throw new Error('AG01_GCP_SHEETS_ACCESS_TOKEN_MISSING');
      }
      const expiresAtMs =
        typeof scopedPayload.expireTime === 'string' &&
        Number.isFinite(Date.parse(scopedPayload.expireTime))
          ? Date.parse(scopedPayload.expireTime)
          : this.#now().getTime() + 3_600_000;
      this.#cache = { token: scopedPayload.accessToken, expiresAtMs };
      return scopedPayload.accessToken;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('AG01_GCP_METADATA_TOKEN_TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async #refresh(): Promise<string> {
    const [clientId, clientSecret, refreshToken] = await Promise.all([
      this.options.secrets.resolve(this.options.clientIdReference),
      this.options.secrets.resolve(this.options.clientSecretReference),
      this.options.secrets.resolve(this.options.refreshTokenReference),
    ]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });
      const response = await this.#fetch(this.#tokenEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: body.toString(),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`AG01_GOOGLE_OAUTH_REFRESH_FAILED:${response.status}`);
      const payload = (await response.json()) as TokenResponse;
      if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
        throw new Error('AG01_GOOGLE_OAUTH_ACCESS_TOKEN_MISSING');
      }
      if (typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in)) {
        throw new Error('AG01_GOOGLE_OAUTH_EXPIRY_MISSING');
      }
      const tokenType =
        typeof payload.token_type === 'string' ? payload.token_type.toLowerCase() : '';
      if (tokenType && tokenType !== 'bearer')
        throw new Error('AG01_GOOGLE_OAUTH_TOKEN_TYPE_INVALID');
      this.#cache = {
        token: payload.access_token,
        expiresAtMs: this.#now().getTime() + Math.max(1, payload.expires_in) * 1000,
      };
      return payload.access_token;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('AG01_GOOGLE_OAUTH_REFRESH_TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
