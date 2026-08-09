export interface SecretReference {
  readonly provider: string;
  readonly key: string;
}

export interface SecretResolver {
  resolve(reference: SecretReference): Promise<string>;
}

export function serializeSecretReference(reference: SecretReference): string {
  return `${reference.provider}:${reference.key}`;
}
