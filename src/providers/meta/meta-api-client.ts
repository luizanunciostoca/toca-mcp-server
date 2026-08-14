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

export interface MetaApiProviderErrorDetails {
  readonly type?: string;
  readonly providerCode?: number;
  readonly providerSubcode?: number;
  readonly reason?: string;
}

export class MetaApiError extends Error {
  readonly type?: string;
  readonly providerCode?: number;
  readonly providerSubcode?: number;
  readonly reason?: string;

  constructor(
    readonly status: number,
    readonly code: string,
    details: MetaApiProviderErrorDetails = {},
  ) {
    super(formatMetaApiErrorMessage(code, details));
    this.name = 'MetaApiError';
    if (details.type !== undefined) this.type = details.type;
    if (details.providerCode !== undefined) this.providerCode = details.providerCode;
    if (details.providerSubcode !== undefined) this.providerSubcode = details.providerSubcode;
    if (details.reason !== undefined) this.reason = details.reason;
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
    return this.requestForm('GET', path, query);
  }

  async post(path: string, body: Readonly<Record<string, string>>): Promise<unknown> {
    return this.requestForm('POST', path, body);
  }

  async postJson(path: string, body: unknown): Promise<unknown> {
    const token = await this.secrets.resolve(this.accessToken);
    return this.postJsonWithAccessToken(path, body, token);
  }

  async postJsonWithAccessToken(
    path: string,
    body: unknown,
    accessToken: string,
  ): Promise<unknown> {
    if (accessToken.length === 0) throw new Error('META_ACCESS_TOKEN_EMPTY');

    const url = this.buildUrl(path);
    const response = await this.transport.request(url.toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) await throwMetaApiError(response);
    return response.json();
  }

  private buildUrl(path: string): URL {
    const base = this.config.graphBaseUrl.replace(/\/$/, '');
    const normalizedPath = path.replace(/^\//, '');
    return new URL(`${base}/${this.config.apiVersion}/${normalizedPath}`);
  }

  private async requestForm(
    method: 'GET' | 'POST',
    path: string,
    values: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    const token = await this.secrets.resolve(this.accessToken);
    const url = this.buildUrl(path);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    let body: string | undefined;

    if (method === 'GET') {
      for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    } else {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(values).toString();
    }

    const response = await this.transport.request(url.toString(), {
      method,
      headers,
      ...(body ? { body } : {}),
    });

    if (!response.ok) await throwMetaApiError(response);
    return response.json();
  }
}

async function throwMetaApiError(response: MetaApiResponse): Promise<never> {
  const fallbackCode = `META_HTTP_${response.status}`;
  let details: MetaApiProviderErrorDetails = {};
  try {
    details = extractMetaProviderError(await response.json());
  } catch {
    // Keep the coarse HTTP code when Meta does not return parseable JSON.
  }
  throw new MetaApiError(response.status, fallbackCode, details);
}

function extractMetaProviderError(value: unknown): MetaApiProviderErrorDetails {
  const root = asRecord(value);
  const error = asRecord(root.error);
  const type = safeScalarString(error.type);
  const providerCode = finiteInteger(error.code);
  const providerSubcode = finiteInteger(error.error_subcode);
  const reasonSource =
    safeScalarString(error.error_user_msg) ||
    safeScalarString(error.error_user_title) ||
    safeScalarString(error.message);
  const reason = sanitizeProviderReason(reasonSource);

  return {
    ...(type ? { type } : {}),
    ...(providerCode !== undefined ? { providerCode } : {}),
    ...(providerSubcode !== undefined ? { providerSubcode } : {}),
    ...(reason ? { reason } : {}),
  };
}

function formatMetaApiErrorMessage(code: string, details: MetaApiProviderErrorDetails): string {
  const parts = [code];
  if (details.providerCode !== undefined) parts.push(`META_CODE_${details.providerCode}`);
  if (details.providerSubcode !== undefined) parts.push(`META_SUBCODE_${details.providerSubcode}`);
  if (details.type) parts.push(`META_TYPE_${sanitizeToken(details.type)}`);
  if (details.reason) parts.push(`META_REASON_${details.reason}`);
  return parts.join('|');
}

function sanitizeProviderReason(value: string): string {
  if (!value) return '';
  return value
    .replace(/(?i:access[_-]?token|authorization|bearer|secret)\s*[:=]?\s*\S+/g, '[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function sanitizeToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function safeScalarString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finiteInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}
