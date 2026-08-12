import type { ConnectedAccountStore } from '../../core/connected-account-store.js';
import { serializeSecretReference } from '../../core/secrets.js';
import type { MetaConnectionProvider, MetaConnectionState } from './meta-connection.js';

export interface MetaConnectionRegistrationInput {
  readonly localAccountId: string;
  readonly label: string;
  readonly state: MetaConnectionState;
}

export interface MetaConnectionRegistrationResult {
  readonly accountId: string;
  readonly status: 'CONNECTED' | 'DEGRADED';
  readonly capabilities: readonly string[];
  readonly reason?: string;
}

export class MetaConnectionService {
  constructor(
    private readonly store: ConnectedAccountStore,
    private readonly provider: MetaConnectionProvider,
  ) {}

  async registerValidatedConnection(
    input: MetaConnectionRegistrationInput,
  ): Promise<MetaConnectionRegistrationResult> {
    const validation = await this.provider.validateConnection(input.state);
    const externalAccountId = validation.providerAccountId ?? input.state.account.externalAccountId;
    const status = validation.healthy ? 'CONNECTED' : 'DEGRADED';

    await this.store.save({
      id: input.localAccountId,
      provider: 'meta',
      externalAccountId,
      label: input.label,
      scopes: [...validation.grantedScopes],
      status,
      tokenReference: serializeSecretReference(input.state.accessToken),
      ...(input.state.expiresAt ? { expiresAt: input.state.expiresAt } : {}),
    });

    return {
      accountId: input.localAccountId,
      status,
      capabilities: validation.capabilities,
      ...(validation.reason ? { reason: validation.reason } : {}),
    };
  }
}
