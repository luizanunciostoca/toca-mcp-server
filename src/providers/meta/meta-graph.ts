import { z } from 'zod/v4';
import type { SecretResolver } from '../../core/secrets.js';
import type {
  MetaConnectionProvider,
  MetaConnectionState,
  MetaConnectionValidation,
  MetaOAuthConfig,
} from './meta-connection.js';

export const metaGraphConfigSchema = z.object({
  graphBaseUrl: z.string().url(),
  apiVersion: z.string().min(1),
});

export type MetaGraphConfig = z.infer<typeof metaGraphConfigSchema>;

export interface MetaHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface MetaHttpTransport {
  get(url: string, headers: Readonly<Record<string, string>>): Promise<MetaHttpResponse>;
}

export class FetchMetaHttpTransport implements MetaHttpTransport {
  async get(url: string, headers: Readonly<Record<string, string>>): Promise<MetaHttpResponse> {
    return fetch(url, { method: 'GET', headers });
  }
}

const debugTokenResponseSchema = z.object({
  data: z.object({
    app_id: z.string().min(1),
    is_valid: z.boolean(),
    scopes: z.array(z.string()).default([]),
    user_id: z.string().min(1).optional(),
    expires_at: z.number().optional(),
    data_access_expires_at: z.number().optional(),
  }),
});

export class MetaGraphConnectionProvider implements MetaConnectionProvider {
  constructor(
    private readonly oauthConfig: MetaOAuthConfig,
    private readonly graphConfig: MetaGraphConfig,
    private readonly secrets: SecretResolver,
    private readonly http: MetaHttpTransport = new FetchMetaHttpTransport(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async validateConnection(state: MetaConnectionState): Promise<MetaConnectionValidation> {
    const [inputToken, appSecret] = await Promise.all([
      this.secrets.resolve(state.accessToken),
      this.secrets.resolve(this.oauthConfig.appSecret),
    ]);

    const url = new URL(
      `${this.graphConfig.graphBaseUrl.replace(/\/$/, '')}/${this.graphConfig.apiVersion}/debug_token`,
    );
    url.searchParams.set('input_token', inputToken);

    const response = await this.http.get(url.toString(), {
      Authorization: `Bearer ${this.oauthConfig.appId}|${appSecret}`,
      Accept: 'application/json',
    });

    if (!response.ok) {
      return this.failure(state, `META_HTTP_${response.status}`);
    }

    const parsed = debugTokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return this.failure(state, 'META_RESPONSE_INVALID');
    }

    const data = parsed.data.data;
    if (!data.is_valid) {
      return this.failure(state, 'TOKEN_INVALID');
    }
    if (data.app_id !== this.oauthConfig.appId) {
      return this.failure(state, 'APP_MISMATCH');
    }

    return {
      healthy: true,
      grantedScopes: [...data.scopes].sort(),
      capabilities: [],
      checkedAt: this.now().toISOString(),
      ...(data.user_id ? { providerAccountId: data.user_id } : {}),
    };
  }

  private failure(state: MetaConnectionState, reason: string): MetaConnectionValidation {
    return {
      healthy: false,
      grantedScopes: [...state.grantedScopes].sort(),
      capabilities: [],
      checkedAt: this.now().toISOString(),
      reason,
    };
  }
}
