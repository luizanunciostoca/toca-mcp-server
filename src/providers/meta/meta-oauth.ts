import { randomBytes, randomUUID } from 'node:crypto';
import type { SecretResolver, SecretStore } from '../../core/secrets.js';
import type {
  MetaOAuthAuthorizationRequest,
  MetaOAuthCallback,
  MetaOAuthConfig,
  MetaOAuthTransport,
  MetaTokenExchangeResult,
} from './meta-connection.js';

const requiredPublicationOAuthScope = 'instagram_content_publish';

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

export interface MetaTokenInspectionOptions {
  readonly graphBaseUrl: string;
  readonly apiVersion: string;
  readonly fetchImpl?: typeof fetch;
}

export class FetchMetaOAuthTransport implements MetaOAuthTransport {
  readonly #fetch: typeof fetch;

  constructor(
    private readonly appSecrets: SecretResolver,
    private readonly tokenStore: SecretStore,
    private readonly inspection?: MetaTokenInspectionOptions,
  ) {
    this.#fetch = inspection?.fetchImpl ?? fetch;
  }

  async exchangeAuthorizationCode(input: {
    readonly code: string;
    readonly redirectUri: string;
    readonly appId: string;
    readonly appSecret: { readonly provider: string; readonly key: string };
    readonly tokenEndpoint: string;
  }): Promise<MetaTokenExchangeResult> {
    const appSecret = await this.appSecrets.resolve(input.appSecret);
    const response = await this.#fetch(input.tokenEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: input.appId,
        client_secret: appSecret,
        redirect_uri: input.redirectUri,
        code: input.code,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Meta token exchange failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
      throw new Error('Meta token exchange did not return an access token');
    }

    const grantedScopes = this.inspection
      ? await this.inspectGrantedScopes(input.appId, appSecret, payload.access_token)
      : [];

    const accessToken = await this.tokenStore.put(
      `meta-access-token-${randomUUID()}`,
      payload.access_token,
    );
    const expiresAt =
      typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : undefined;

    return {
      accessToken,
      grantedScopes,
      ...(expiresAt ? { expiresAt } : {}),
    };
  }

  private async inspectGrantedScopes(
    appId: string,
    appSecret: string,
    inputToken: string,
  ): Promise<readonly string[]> {
    if (!this.inspection) return [];

    const url = new URL(
      `${this.inspection.graphBaseUrl.replace(/\/$/, '')}/${this.inspection.apiVersion}/debug_token`,
    );
    url.searchParams.set('input_token', inputToken);

    const response = await this.#fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${appId}|${appSecret}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Meta token inspection failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: {
        app_id?: unknown;
        is_valid?: unknown;
        scopes?: unknown;
      };
    };
    const data = payload.data;
    if (!data || data.is_valid !== true) {
      throw new Error('Meta token inspection returned an invalid token');
    }
    if (data.app_id !== appId) {
      throw new Error('Meta token inspection returned an app mismatch');
    }
    if (!Array.isArray(data.scopes) || !data.scopes.every((scope) => typeof scope === 'string')) {
      throw new Error('Meta token inspection returned invalid scopes');
    }

    return [...new Set(data.scopes)].sort();
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
    const requestedScopes = [...new Set([...this.config.requestedScopes, requiredPublicationOAuthScope])]
      .sort();
    authorizationUrl.searchParams.set('scope', requestedScopes.join(','));
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
