import { ExecutionError } from '../../core/errors.js';
import type { SecretReference, SecretResolver } from '../../core/secrets.js';

const DEFAULT_METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

const SCOPE_SETS = {
  'workspace-readonly': [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  ],
  'cloud-platform': ['https://www.googleapis.com/auth/cloud-platform'],
} as const;

export type GoogleMetadataScopeSet = keyof typeof SCOPE_SETS;

interface CachedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

export interface GoogleMetadataAccessTokenResolverOptions {
  readonly fetchImpl?: typeof fetch;
  readonly metadataTokenUrl?: string;
  readonly now?: () => number;
}

export class GoogleMetadataAccessTokenResolver implements SecretResolver {
  private readonly fetchImpl: typeof fetch;
  private readonly metadataTokenUrl: string;
  private readonly now: () => number;
  private readonly cache = new Map<GoogleMetadataScopeSet, CachedToken>();

  constructor(private readonly options: GoogleMetadataAccessTokenResolverOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.metadataTokenUrl = options.metadataTokenUrl ?? DEFAULT_METADATA_TOKEN_URL;
    this.now = options.now ?? Date.now;
  }

  async resolve(reference: SecretReference): Promise<string> {
    if (reference.provider !== 'gcp-metadata-oauth' || !(reference.key in SCOPE_SETS)) {
      throw new Error('GCP_METADATA_ACCESS_TOKEN_REFERENCE_INVALID');
    }
    const scopeSet = reference.key as GoogleMetadataScopeSet;
    const cached = this.cache.get(scopeSet);
    const nowMs = this.now();
    if (cached && cached.expiresAtMs - 60_000 > nowMs) return cached.token;

    const url = new URL(this.metadataTokenUrl);
    url.searchParams.set('scopes', SCOPE_SETS[scopeSet].join(','));
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { 'Metadata-Flavor': 'Google' },
    });
    if (!response.ok) {
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `GCP_METADATA_ACCESS_TOKEN_FAILED:${response.status}`,
        response.status === 429 || response.status >= 500,
      );
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
        'GCP_METADATA_ACCESS_TOKEN_RESPONSE_INVALID',
        false,
      );
    }
    const token = payload.access_token.trim();
    this.cache.set(scopeSet, {
      token,
      expiresAtMs: nowMs + payload.expires_in * 1_000,
    });
    return token;
  }
}
