import { randomBytes } from 'node:crypto';
import type {
  MetaOAuthAuthorizationRequest,
  MetaOAuthCallback,
  MetaOAuthConfig,
  MetaOAuthTransport,
  MetaTokenExchangeResult,
} from './meta-connection.js';

interface OAuthStateRecord {
  readonly state: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt?: string;
}

export interface OAuthStateStore {
  save(record: OAuthStateRecord): Promise<void>;
  consume(state: string, now: Date): Promise<OAuthStateRecord | undefined>;
}

export class InMemoryOAuthStateStore implements OAuthStateStore {
  readonly #records = new Map<string, OAuthStateRecord>();

  save(record: OAuthStateRecord): Promise<void> {
    this.#records.set(record.state, record);
    return Promise.resolve();
  }

  consume(state: string, now: Date): Promise<OAuthStateRecord | undefined> {
    const record = this.#records.get(state);
    if (!record || record.consumedAt || Date.parse(record.expiresAt) <= now.getTime()) {
      return Promise.resolve(undefined);
    }

    const consumed = { ...record, consumedAt: now.toISOString() };
    this.#records.set(state, consumed);
    return Promise.resolve(consumed);
  }
}

export interface MetaOAuthServiceOptions {
  readonly stateTtlMs?: number;
  readonly now?: () => Date;
}

export class MetaOAuthService {
  readonly #stateTtlMs: number;
  readonly #now: () => Date;

  constructor(
    private readonly config: MetaOAuthConfig,
    private readonly stateStore: OAuthStateStore,
    private readonly transport: MetaOAuthTransport,
    options: MetaOAuthServiceOptions = {},
  ) {
    this.#stateTtlMs = options.stateTtlMs ?? 10 * 60 * 1000;
    this.#now = options.now ?? (() => new Date());
  }

  async beginAuthorization(): Promise<MetaOAuthAuthorizationRequest> {
    const now = this.#now();
    const state = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.#stateTtlMs).toISOString();

    await this.stateStore.save({
      state,
      createdAt: now.toISOString(),
      expiresAt,
    });

    const authorizationUrl = new URL(this.config.authorizationEndpoint);
    authorizationUrl.searchParams.set('client_id', this.config.appId);
    authorizationUrl.searchParams.set('redirect_uri', this.config.redirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', this.config.requestedScopes.join(','));
    authorizationUrl.searchParams.set('state', state);

    return { authorizationUrl: authorizationUrl.toString(), state, expiresAt };
  }

  async completeAuthorization(callback: MetaOAuthCallback): Promise<MetaTokenExchangeResult> {
    const state = await this.stateStore.consume(callback.state, this.#now());
    if (!state) {
      throw new Error('Invalid, expired or already-consumed OAuth state');
    }

    return this.transport.exchangeAuthorizationCode({
      code: callback.code,
      redirectUri: this.config.redirectUri,
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      tokenEndpoint: this.config.tokenEndpoint,
    });
  }
}
