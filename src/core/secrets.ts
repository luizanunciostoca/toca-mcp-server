export interface SecretReference {
  readonly provider: string;
  readonly key: string;
}

export interface SecretResolver {
  resolve(reference: SecretReference): Promise<string>;
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

export function serializeSecretReference(reference: SecretReference): string {
  return `${reference.provider}:${reference.key}`;
}
