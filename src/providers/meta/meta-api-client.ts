import type { SecretReference, SecretResolver } from '../../core/secrets.js';

export interface MetaApiClientConfig {
  readonly graphBaseUrl: string;
  readonly apiVersion: string;
}

export interface MetaApiResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface MetaApiTransport {
  request(url: string, init: RequestInit): Promise<MetaApiResponse>;
}

export class FetchMetaApiTransport implements MetaApiTransport {
  async request(url: string, init: RequestInit): Promise<MetaApiResponse> {
    return fetch(url, init);
  }
}

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'MetaApiError';
  }
}

export class MetaApiClient {
  constructor(
    private readonly config: MetaApiClientConfig,
    private readonly secrets: SecretResolver,
    private readonly accessToken: SecretReference,
    private readonly transport: MetaApiTransport = new FetchMetaApiTransport(),
  ) {}

  async get(path: string, query: Readonly<Record<string, string>> = {}): Promise<unknown> {
    const token = await this.secrets.resolve(this.accessToken);
    const base = this.config.graphBaseUrl.replace(/\/$/, '');
    const normalizedPath = path.replace(/^\//, '');
    const url = new URL(`${base}/${this.config.apiVersion}/${normalizedPath}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    const response = await this.transport.request(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) throw new MetaApiError(response.status, `META_HTTP_${response.status}`);
    return response.json();
  }
}
