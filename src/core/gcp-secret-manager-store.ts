import type { SecretReference, SecretStore } from './secrets.js';

interface SecretManagerAccessResponse {
  readonly payload?: { readonly data?: string };
}

export interface GcpSecretManagerStoreOptions {
  readonly projectId: string;
  readonly accessToken?: () => Promise<string>;
  readonly fetchImpl?: typeof fetch;
}

async function metadataAccessToken(fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!response.ok) {
    throw new Error(`GCP metadata token request failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
    throw new Error('GCP metadata token response did not contain an access token');
  }
  return payload.access_token;
}

export class GcpSecretManagerStore implements SecretStore {
  readonly #projectId: string;
  readonly #fetch: typeof fetch;
  readonly #accessToken: () => Promise<string>;

  constructor(options: GcpSecretManagerStoreOptions) {
    this.#projectId = options.projectId;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#accessToken = options.accessToken ?? (() => metadataAccessToken(this.#fetch));
  }

  async #request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.#accessToken();
    return this.#fetch(`https://secretmanager.googleapis.com/v1/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
  }

  async resolve(reference: SecretReference): Promise<string> {
    if (reference.provider !== 'gcp-secret-manager') {
      throw new Error('Secret provider mismatch');
    }
    const response = await this.#request(
      `projects/${encodeURIComponent(this.#projectId)}/secrets/${encodeURIComponent(reference.key)}/versions/latest:access`,
    );
    if (!response.ok) {
      throw new Error(`Secret Manager access failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as SecretManagerAccessResponse;
    if (!payload.payload?.data) {
      throw new Error('Secret Manager response did not contain secret data');
    }
    return Buffer.from(payload.payload.data, 'base64').toString('utf8');
  }

  async put(key: string, value: string): Promise<SecretReference> {
    const secretName = key.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 255);
    const parent = `projects/${encodeURIComponent(this.#projectId)}`;
    const create = await this.#request(
      `${parent}/secrets?secretId=${encodeURIComponent(secretName)}`,
      {
        method: 'POST',
        body: JSON.stringify({ replication: { automatic: {} } }),
      },
    );
    if (!create.ok && create.status !== 409) {
      throw new Error(`Secret Manager create failed with HTTP ${create.status}`);
    }

    const version = await this.#request(
      `${parent}/secrets/${encodeURIComponent(secretName)}:addVersion`,
      {
        method: 'POST',
        body: JSON.stringify({
          payload: { data: Buffer.from(value, 'utf8').toString('base64') },
        }),
      },
    );
    if (!version.ok) {
      throw new Error(`Secret Manager addVersion failed with HTTP ${version.status}`);
    }
    return { provider: 'gcp-secret-manager', key: secretName };
  }

  async delete(reference: SecretReference): Promise<void> {
    if (reference.provider !== 'gcp-secret-manager') return;
    const response = await this.#request(
      `projects/${encodeURIComponent(this.#projectId)}/secrets/${encodeURIComponent(reference.key)}`,
      { method: 'DELETE' },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Secret Manager delete failed with HTTP ${response.status}`);
    }
  }
}
