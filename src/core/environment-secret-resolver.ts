import type { SecretReference, SecretResolver } from './secrets.js';

export class EnvironmentSecretResolver implements SecretResolver {
  constructor(
    private readonly provider = 'gcp-secret-manager',
    private readonly prefix = 'TOCA_SECRET_',
  ) {}

  resolve(reference: SecretReference): Promise<string> {
    if (reference.provider !== this.provider) {
      return Promise.reject(new Error('Secret provider mismatch'));
    }
    const envKey = `${this.prefix}${reference.key.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`;
    const value = process.env[envKey];
    if (!value) {
      return Promise.reject(new Error(`Secret environment binding missing: ${envKey}`));
    }
    return Promise.resolve(value);
  }
}
