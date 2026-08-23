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
  /** Hard upper bound for one provider HTTP attempt. */
  readonly requestTimeoutMs?: number;
  /** Maximum attempts for reads and validateOnly requests. Real mutations stay single-attempt. */
  readonly maxSafeAttempts?: number;
  /** Local exponential backoff floor. Retry-After may raise this delay. */
  readonly retryBaseDelayMs?: number;
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

type RetryMode = 'SAFE' | 'NONE';

class GoogleAdsRequestTimeoutError extends Error {
  constructor() {
    super('GOOGLE_ADS_PROVIDER_TIMEOUT');
    this.name = 'GoogleAdsRequestTimeoutError';
  }
}

class GoogleAdsProviderRequestError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly retryAfterMs: number | null,
    readonly retryable: boolean,
    providerStatus: string,
  ) {
    super(`GOOGLE_ADS_PROVIDER_ERROR:${providerStatus}`);
    this.name = 'GoogleAdsProviderRequestError';
  }
}

export class GoogleAdsRestApiClient implements GoogleAdsApiClient {
  readonly #apiVersion: string;
  readonly #apiBaseUrl: string;
  readonly #customerId: string | undefined;
  readonly #requestTimeoutMs: number;
  readonly #maxSafeAttempts: number;
  readonly #retryBaseDelayMs: number;
  #cachedOAuthToken: CachedOAuthToken | undefined;

  constructor(
    private readonly config: GoogleAdsApiClientConfig,
    private readonly secrets: SecretResolver,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#apiVersion = config.apiVersion ?? 'v25';
    this.#apiBaseUrl = (config.apiBaseUrl ?? 'https://googleads.googleapis.com').replace(/\/$/, '');
    this.#customerId = config.customerId ? normalizeCustomerId(config.customerId) : undefined;
    this.#requestTimeoutMs = positiveInteger(
      config.requestTimeoutMs ?? 10_000,
      'GOOGLE_ADS_TIMEOUT_INVALID',
    );
    this.#maxSafeAttempts = positiveInteger(
      config.maxSafeAttempts ?? 3,
      'GOOGLE_ADS_MAX_ATTEMPTS_INVALID',
    );
    this.#retryBaseDelayMs = nonNegativeInteger(
      config.retryBaseDelayMs ?? 250,
      'GOOGLE_ADS_RETRY_DELAY_INVALID',
    );
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
      'SAFE',
    );
  }

  search(
    query: string,
    pageToken?: string,
  ): Promise<GoogleAdsApiResponse<Record<string, unknown>>> {
    const customerId = this.requireCustomerId();
    return this.request(
      `/customers/${customerId}/googleAds:search`,
      {
        query,
        ...(pageToken ? { pageToken } : {}),
      },
      'POST',
      'SAFE',
    );
  }

  mutate(
    path: string,
    body: Record<string, unknown>,
  ): Promise<GoogleAdsApiResponse<Record<string, unknown>>> {
    const customerId = this.requireCustomerId();
    if (!path.startsWith(`/customers/${customerId}/`)) {
      return Promise.reject(new Error('GOOGLE_ADS_CUSTOMER_BOUNDARY_VIOLATION'));
    }
    // validateOnly has no provider side effect and may be retried. Real writes are intentionally
    // single-attempt because an ambiguous timeout must never create a duplicate mutation.
    return this.request(path, body, 'POST', body.validateOnly === true ? 'SAFE' : 'NONE');
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
    let response: Response;
    try {
      response = await this.fetchWithTimeout(
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
    } catch (error) {
      if (error instanceof GoogleAdsRequestTimeoutError) {
        throw new Error('GOOGLE_ADS_OAUTH_TIMEOUT');
      }
      throw error;
    }
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
    retryMode: RetryMode = 'NONE',
  ): Promise<GoogleAdsApiResponse<T>> {
    const [accessToken, developerToken] = await Promise.all([
      this.accessToken(),
      this.secrets.resolve(this.config.developerTokenRef),
    ]);
    const maximumAttempts = retryMode === 'SAFE' ? this.#maxSafeAttempts : 1;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(
          `${this.#apiBaseUrl}/${this.#apiVersion}${path}`,
          {
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
          },
        );
        const payload = (await response.json().catch(() => ({}))) as T & {
          error?: { message?: string; status?: string };
        };
        if (!response.ok) {
          const providerStatus = payload.error?.status ?? `HTTP_${response.status}`;
          const retryable = isRetryableHttpStatus(response.status);
          const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
          if (retryMode === 'SAFE' && retryable && attempt < maximumAttempts) {
            await this.waitForRetry(attempt, retryAfterMs);
            continue;
          }
          throw new GoogleAdsProviderRequestError(
            response.status,
            retryAfterMs,
            retryable,
            providerStatus,
          );
        }
        const requestId = response.headers.get('request-id');
        return {
          body: payload,
          ...(requestId ? { requestId } : {}),
        };
      } catch (error) {
        if (error instanceof GoogleAdsProviderRequestError) throw error;
        const retryableTransport = isRetryableTransportError(error);
        if (retryMode === 'SAFE' && retryableTransport && attempt < maximumAttempts) {
          await this.waitForRetry(attempt, null);
          continue;
        }
        if (error instanceof GoogleAdsRequestTimeoutError) throw error;
        if (retryableTransport) {
          throw new Error(`GOOGLE_ADS_PROVIDER_TRANSPORT_ERROR:${safeTransportCode(error)}`);
        }
        throw error;
      }
    }

    throw new Error('GOOGLE_ADS_PROVIDER_RETRY_EXHAUSTED');
  }

  private async fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#requestTimeoutMs);
    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw new GoogleAdsRequestTimeoutError();
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitForRetry(attempt: number, retryAfterMs: number | null): Promise<void> {
    const localDelay = this.#retryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
    const delayMs = Math.max(localDelay, retryAfterMs ?? 0);
    if (delayMs <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
}

export function normalizeCustomerId(value: string): string {
  const normalized = value.replace(/-/g, '').trim();
  if (!/^\d{10}$/.test(normalized)) throw new Error('GOOGLE_ADS_CUSTOMER_ID_INVALID');
  return normalized;
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isRetryableTransportError(error: unknown): boolean {
  if (error instanceof GoogleAdsRequestTimeoutError) return true;
  if (!(error instanceof Error)) return false;
  return (
    error instanceof TypeError ||
    /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/.test(
      `${error.name}:${error.message}`,
    )
  );
}

function safeTransportCode(error: unknown): string {
  if (!(error instanceof Error)) return 'UNKNOWN';
  const value = `${error.name}:${error.message}`.replace(/[^A-Za-z0-9:_-]/g, '_').slice(0, 120);
  return value || 'UNKNOWN';
}

function positiveInteger(value: number, code: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function nonNegativeInteger(value: number, code: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(code);
  return value;
}
