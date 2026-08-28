import type { SecretReference, SecretResolver } from '../core/secrets.js';

export const AG01_GCP_METADATA_REFERENCE_KEY = '__ag01_gcp_metadata__';
const DEFAULT_METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

interface GoogleOAuthRefreshOptions {
  readonly clientIdReference: SecretReference;
  readonly clientSecretReference: SecretReference;
  readonly refreshTokenReference: SecretReference;
  readonly secrets: SecretResolver;
  readonly tokenEndpoint?: string;
  readonly metadataTokenEndpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => Date;
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly expires_in?: unknown;
  readonly token_type?: unknown;
}

export class GoogleOAuthRefreshSecretResolver implements SecretResolver {
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #tokenEndpoint: string;
  readonly #metadataTokenEndpoint: string;
  readonly #timeoutMs: number;
  #cache: { readonly token: string; readonly expiresAtMs: number } | undefined;
  #inFlight: Promise<string> | undefined;

  constructor(private readonly options: GoogleOAuthRefreshOptions) {
    this.#fetch = options.fetchFn ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#tokenEndpoint = options.tokenEndpoint ?? 'https://oauth2.googleapis.com/token';
    this.#metadataTokenEndpoint = options.metadataTokenEndpoint ?? DEFAULT_METADATA_TOKEN_URL;
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
    const refresh = this.#usesGcpMetadata() ? this.#metadataToken() : this.#refresh();
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

  async #metadataToken(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(this.#metadataTokenEndpoint, {
        headers: { 'Metadata-Flavor': 'Google', accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`AG01_GCP_METADATA_TOKEN_FAILED:${response.status}`);
      const payload = (await response.json()) as TokenResponse;
      if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
        throw new Error('AG01_GCP_METADATA_ACCESS_TOKEN_MISSING');
      }
      if (typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in)) {
        throw new Error('AG01_GCP_METADATA_EXPIRY_MISSING');
      }
      this.#cache = {
        token: payload.access_token,
        expiresAtMs: this.#now().getTime() + Math.max(1, payload.expires_in) * 1000,
      };
      return payload.access_token;
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
