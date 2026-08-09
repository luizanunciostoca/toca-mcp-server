import { z } from 'zod/v4';
import type { ConnectedAccount } from '../../core/connected-account.js';
import type { SecretReference } from '../../core/secrets.js';

export const metaOAuthConfigSchema = z.object({
  appId: z.string().min(1),
  appSecret: z.object({
    provider: z.string().min(1),
    key: z.string().min(1),
  }),
  redirectUri: z.string().url(),
  requestedScopes: z.array(z.string().min(1)).min(1),
});

export type MetaOAuthConfig = z.infer<typeof metaOAuthConfigSchema>;

export interface MetaConnectionState {
  readonly account: ConnectedAccount;
  readonly accessToken: SecretReference;
  readonly grantedScopes: readonly string[];
  readonly expiresAt?: string;
  readonly connectedAt: string;
  readonly lastValidatedAt?: string;
}

export interface MetaConnectionProvider {
  validateConnection(state: MetaConnectionState): Promise<MetaConnectionValidation>;
}

export interface MetaConnectionValidation {
  readonly healthy: boolean;
  readonly providerAccountId?: string;
  readonly grantedScopes: readonly string[];
  readonly capabilities: readonly string[];
  readonly checkedAt: string;
  readonly reason?: string;
}
