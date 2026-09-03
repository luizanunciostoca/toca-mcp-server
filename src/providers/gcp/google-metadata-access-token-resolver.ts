import { ExecutionError } from '../../core/errors.js';
import type { SecretReference, SecretResolver } from '../../core/secrets.js';

const DEFAULT_METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

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
  private cached: CachedToken | undefined;

  constructor(private readonly options: GoogleMetadataAccessTokenResolverOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.metadataTokenUrl = options.metadataTokenUrl ?? DEFAULT_METADATA_TOKEN_URL;
    this.now = options.now ?? Date.now;
  }

  async resolve(reference: SecretReference): Promise<string> {
    if (reference.provider !== 'gcp-metadata-oauth' || reference.key !== 'cloud-platform') {
      throw new Error('GCP_METADATA_ACCESS_TOKEN_REFERENCE_INVALID');
    }
    const nowMs = this.now();
    if (this.cached && this.cached.expiresAtMs - 60_000 > nowMs) return this.cached.token;

    const response = await this.fetchImpl(this.metadataTokenUrl, {
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
    this.cached = {
      token,
      expiresAtMs: nowMs + payload.expires_in * 1_000,
    };
    return token;
  }
}
