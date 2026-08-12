import type { ConnectedAccount } from './connected-account.js';

export interface ConnectedAccountStore {
  get(id: string): Promise<ConnectedAccount | undefined>;
  save(account: ConnectedAccount): Promise<void>;
  listByProvider(provider: string): Promise<readonly ConnectedAccount[]>;
}

export class InMemoryConnectedAccountStore implements ConnectedAccountStore {
  readonly #accounts = new Map<string, ConnectedAccount>();

  get(id: string): Promise<ConnectedAccount | undefined> {
    return Promise.resolve(this.#accounts.get(id));
  }

  save(account: ConnectedAccount): Promise<void> {
    this.#accounts.set(account.id, account);
    return Promise.resolve();
  }

  listByProvider(provider: string): Promise<readonly ConnectedAccount[]> {
    return Promise.resolve(
      [...this.#accounts.values()]
        .filter((account) => account.provider === provider)
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  }
}
