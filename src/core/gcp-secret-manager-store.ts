import type { SecretReference, SecretStore } from './secrets.js';

interface SecretManagerAccessResponse {
  readonly payload?: { readonly data?: string };
}

interface SecretManagerVersionResponse {
  readonly name?: string;
}

export interface GcpSecretManagerStoreOptions {
  readonly projectId: string;
  readonly secretId: string;
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
  readonly #secretId: string;
  readonly #fetch: typeof fetch;
  readonly #accessToken: () => Promise<string>;

  constructor(options: GcpSecretManagerStoreOptions) {
    this.#projectId = options.projectId;
    this.#secretId = options.secretId;
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

  #versionPath(reference: SecretReference): string {
    if (reference.provider !== 'gcp-secret-manager') {
      throw new Error('Secret provider mismatch');
    }
    const prefix = `${this.#secretId}/versions/`;
    if (!reference.key.startsWith(prefix) || reference.key.length === prefix.length) {
      throw new Error('Secret reference does not belong to the configured secret');
    }
    return `projects/${encodeURIComponent(this.#projectId)}/secrets/${encodeURIComponent(this.#secretId)}/versions/${encodeURIComponent(reference.key.slice(prefix.length))}`;
  }

  async resolve(reference: SecretReference): Promise<string> {
    const response = await this.#request(`${this.#versionPath(reference)}:access`);
    if (!response.ok) {
      throw new Error(`Secret Manager access failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as SecretManagerAccessResponse;
    if (!payload.payload?.data) {
      throw new Error('Secret Manager response did not contain secret data');
    }
    return Buffer.from(payload.payload.data, 'base64').toString('utf8');
  }

  async put(_key: string, value: string): Promise<SecretReference> {
    const path = `projects/${encodeURIComponent(this.#projectId)}/secrets/${encodeURIComponent(this.#secretId)}:addVersion`;
    const response = await this.#request(path, {
      method: 'POST',
      body: JSON.stringify({
        payload: { data: Buffer.from(value, 'utf8').toString('base64') },
      }),
    });
    if (!response.ok) {
      throw new Error(`Secret Manager addVersion failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as SecretManagerVersionResponse;
    const version = payload.name?.split('/').at(-1);
    if (!version) {
      throw new Error('Secret Manager addVersion response did not contain a version name');
    }
    return {
      provider: 'gcp-secret-manager',
      key: `${this.#secretId}/versions/${version}`,
    };
  }

  async delete(reference: SecretReference): Promise<void> {
    const response = await this.#request(`${this.#versionPath(reference)}:destroy`, {
      method: 'POST',
      body: '{}',
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Secret Manager destroy version failed with HTTP ${response.status}`);
    }
  }
}
