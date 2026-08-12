export interface SecretReference {
  readonly provider: string;
  readonly key: string;
}

export interface SecretResolver {
  resolve(reference: SecretReference): Promise<string>;
}

export interface SecretStore extends SecretResolver {
  put(key: string, value: string): Promise<SecretReference>;
  delete(reference: SecretReference): Promise<void>;
}

export class EnvironmentSecretResolver implements SecretResolver {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  resolve(reference: SecretReference): Promise<string> {
    if (reference.provider !== 'env') {
      return Promise.reject(new Error(`Unsupported secret provider: ${reference.provider}`));
    }

    const value = this.env[reference.key];
    if (!value?.trim()) {
      return Promise.reject(new Error(`Missing environment secret: ${reference.key}`));
    }
    return Promise.resolve(value);
  }
}

export class InMemorySecretStore implements SecretStore {
  readonly #values = new Map<string, string>();

  constructor(private readonly provider = 'memory') {}

  resolve(reference: SecretReference): Promise<string> {
    if (reference.provider !== this.provider) {
      return Promise.reject(new Error('Secret provider mismatch'));
    }
    const value = this.#values.get(reference.key);
    if (value === undefined) {
      return Promise.reject(new Error('Secret not found'));
    }
    return Promise.resolve(value);
  }

  put(key: string, value: string): Promise<SecretReference> {
    this.#values.set(key, value);
    return Promise.resolve({ provider: this.provider, key });
  }

  delete(reference: SecretReference): Promise<void> {
    if (reference.provider === this.provider) {
      this.#values.delete(reference.key);
    }
    return Promise.resolve();
  }
}

export function serializeSecretReference(reference: SecretReference): string {
  return `${reference.provider}:${reference.key}`;
}
