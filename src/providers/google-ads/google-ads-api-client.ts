import type { SecretReference, SecretResolver } from '../../core/secrets.js';

export interface GoogleAdsApiClientConfig {
  readonly apiVersion?: string;
  readonly customerId: string;
  readonly loginCustomerId?: string;
  readonly accessTokenRef: SecretReference;
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

export class GoogleAdsRestApiClient implements GoogleAdsApiClient {
  readonly #apiVersion: string;
  readonly #apiBaseUrl: string;
  readonly #customerId: string;

  constructor(
    private readonly config: GoogleAdsApiClientConfig,
    private readonly secrets: SecretResolver,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#apiVersion = config.apiVersion ?? 'v25';
    this.#apiBaseUrl = (config.apiBaseUrl ?? 'https://googleads.googleapis.com').replace(/\/$/, '');
    this.#customerId = normalizeCustomerId(config.customerId);
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
    return this.request(`/customers/${this.#customerId}/googleAds:search`, {
      query,
      ...(pageToken ? { pageToken } : {}),
    });
  }

  mutate(
    path: string,
    body: Record<string, unknown>,
  ): Promise<GoogleAdsApiResponse<Record<string, unknown>>> {
    if (!path.startsWith(`/customers/${this.#customerId}/`)) {
      return Promise.reject(new Error('GOOGLE_ADS_CUSTOMER_BOUNDARY_VIOLATION'));
    }
    return this.request(path, body);
  }

  private async request<T>(
    path: string,
    body?: Record<string, unknown>,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<GoogleAdsApiResponse<T>> {
    const [accessToken, developerToken] = await Promise.all([
      this.secrets.resolve(this.config.accessTokenRef),
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
