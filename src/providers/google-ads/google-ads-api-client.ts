import type { SecretReference, SecretResolver } from '../../core/secrets.js';

export interface GoogleAdsOAuthRefreshConfig {
  readonly clientIdRef: SecretReference;
  readonly clientSecretRef: SecretReference;
  readonly refreshTokenRef: SecretReference;
  readonly tokenEndpoint?: string;
}

export interface GoogleAdsApiClientConfig {
  readonly apiVersion?: string;
  /** Required only for customer-bound search/mutate calls, not credential discovery. */
  readonly customerId?: string;
  readonly loginCustomerId?: string;
  readonly accessTokenRef?: SecretReference;
  readonly oauthRefresh?: GoogleAdsOAuthRefreshConfig;
  readonly developerTokenRef: SecretReference;
  readonly apiBaseUrl?: string;
}

export interface GoogleAdsApiResponse<T = Record<string, unknown>> {
  readonly body: T;
  readonly requestId?: string;
}

export interface GoogleAdsApiClient {
  listAccessibleCustomers(): Promise<GoogleAdsApiResponse<{ resourceNames?: string[] }>>;
  search(query: string, pageToken?: string): Promise<GoogleAdsApiResponse<Record<string, unknown>>>;
  mutate(
    path: string,
    body: Record<string, unknown>,
  ): Promise<GoogleAdsApiResponse<Record<string, unknown>>>;
}

interface CachedOAuthToken {
  readonly value: string;
  readonly refreshAfterMs: number;
}

export class GoogleAdsRestApiClient implements GoogleAdsApiClient {
  readonly #apiVersion: string;
  readonly #apiBaseUrl: string;
  readonly #customerId: string | undefined;
  #cachedOAuthToken: CachedOAuthToken | undefined;

  constructor(
    private readonly config: GoogleAdsApiClientConfig,
    private readonly secrets: SecretResolver,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#apiVersion = config.apiVersion ?? 'v25';
    this.#apiBaseUrl = (config.apiBaseUrl ?? 'https://googleads.googleapis.com').replace(/\/$/, '');
    this.#customerId = config.customerId ? normalizeCustomerId(config.customerId) : undefined;
    const hasStaticToken = config.accessTokenRef !== undefined;
    const hasRefreshCredentials = config.oauthRefresh !== undefined;
    if (hasStaticToken === hasRefreshCredentials) {
      throw new Error('GOOGLE_ADS_EXACTLY_ONE_AUTH_MODE_REQUIRED');
    }
  }

  listAccessibleCustomers(): Promise<GoogleAdsApiResponse<{ resourceNames?: string[] }>> {
    return this.request<{ resourceNames?: string[] }>(
      `/customers:listAccessibleCustomers`,
      undefined,
      'GET',
    );
  }

  search(
    query: string,
    pageToken?: string,
  ): Promise<GoogleAdsApiResponse<Record<string, unknown>>> {
    const customerId = this.requireCustomerId();
    return this.request(`/customers/${customerId}/googleAds:search`, {
      query,
      ...(pageToken ? { pageToken } : {}),
    });
  }

  mutate(
    path: string,
    body: Record<string, unknown>,
  ): Promise<GoogleAdsApiResponse<Record<string, unknown>>> {
    const customerId = this.requireCustomerId();
    if (!path.startsWith(`/customers/${customerId}/`)) {
      return Promise.reject(new Error('GOOGLE_ADS_CUSTOMER_BOUNDARY_VIOLATION'));
    }
    return this.request(path, body);
  }

  private requireCustomerId(): string {
    if (!this.#customerId) throw new Error('GOOGLE_ADS_CUSTOMER_ID_REQUIRED');
    return this.#customerId;
  }

  private async accessToken(): Promise<string> {
    if (this.config.accessTokenRef) return this.secrets.resolve(this.config.accessTokenRef);
    if (this.#cachedOAuthToken && Date.now() < this.#cachedOAuthToken.refreshAfterMs) {
      return this.#cachedOAuthToken.value;
    }
    const oauth = this.config.oauthRefresh;
    if (!oauth) throw new Error('GOOGLE_ADS_OAUTH_REFRESH_CONFIG_REQUIRED');
    const [clientId, clientSecret, refreshToken] = await Promise.all([
      this.secrets.resolve(oauth.clientIdRef),
      this.secrets.resolve(oauth.clientSecretRef),
      this.secrets.resolve(oauth.refreshTokenRef),
    ]);
    const response = await this.fetchImpl(
      oauth.tokenEndpoint ?? 'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: unknown;
      expires_in?: unknown;
      error?: unknown;
    };
    if (!response.ok) {
      const errorCode =
        typeof payload.error === 'string' ? payload.error : `HTTP_${response.status}`;
      throw new Error(`GOOGLE_ADS_OAUTH_ERROR:${errorCode}`);
    }
    if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
      throw new Error('GOOGLE_ADS_OAUTH_ACCESS_TOKEN_MISSING');
    }
    const expiresInSeconds =
      typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
        ? Math.max(60, payload.expires_in)
        : 3_600;
    this.#cachedOAuthToken = {
      value: payload.access_token,
      refreshAfterMs: Date.now() + Math.max(0, expiresInSeconds - 60) * 1_000,
    };
    return payload.access_token;
  }

  private async request<T>(
    path: string,
    body?: Record<string, unknown>,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<GoogleAdsApiResponse<T>> {
    const [accessToken, developerToken] = await Promise.all([
      this.accessToken(),
      this.secrets.resolve(this.config.developerTokenRef),
    ]);
    const response = await this.fetchImpl(`${this.#apiBaseUrl}/${this.#apiVersion}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
        ...(this.config.loginCustomerId
          ? { 'login-customer-id': normalizeCustomerId(this.config.loginCustomerId) }
          : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = (await response.json().catch(() => ({}))) as T & {
      error?: { message?: string; status?: string };
    };
    if (!response.ok) {
      const status = payload.error?.status ?? `HTTP_${response.status}`;
      throw new Error(`GOOGLE_ADS_PROVIDER_ERROR:${status}`);
    }
    const requestId = response.headers.get('request-id');
    return {
      body: payload,
      ...(requestId ? { requestId } : {}),
    };
  }
}

export function normalizeCustomerId(value: string): string {
  const normalized = value.replace(/-/g, '').trim();
  if (!/^\d{10}$/.test(normalized)) throw new Error('GOOGLE_ADS_CUSTOMER_ID_INVALID');
  return normalized;
}
