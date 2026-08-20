import type { ConnectedAccount } from '../core/connected-account.js';
import type { ConnectedAccountStore } from '../core/connected-account-store.js';
import { authorizeExecution, type ExecutionIdentity } from '../core/identity.js';
import type { SecretResolver } from '../core/secrets.js';
import type {
  TenantBoundaryExpectation,
  TenantConfiguration,
  TenantConfigurationStore,
  TenantScope,
} from './contracts.js';
import { assertSameTenantBoundary, TenantIsolationError } from './tenant-configuration.js';

export interface ResolvedTenantProviderAccess {
  readonly providerId: string;
  readonly connectedAccount: ConnectedAccount;
  readonly secret: string;
  readonly evidence: readonly string[];
}

export class TenantCredentialResolver {
  constructor(
    private readonly configurations: TenantConfigurationStore,
    private readonly connectedAccounts: ConnectedAccountStore,
    private readonly secrets: SecretResolver,
  ) {}

  async resolve(input: {
    readonly identity: ExecutionIdentity;
    readonly providerId: string;
    readonly expectation: TenantBoundaryExpectation;
  }): Promise<ResolvedTenantProviderAccess> {
    const configuration = await this.requireTenantConfiguration(input.identity);
    if (configuration.status !== 'ACTIVE') {
      throw new TenantIsolationError('TENANT_SUSPENDED');
    }

    const authorization = authorizeExecution(input.identity, input.expectation);
    if (!authorization.allowed) throw new TenantIsolationError(authorization.reason);

    const capabilityId = input.expectation.capabilityId;
    if (configuration.deniedCapabilityIds.includes(capabilityId)) {
      throw new TenantIsolationError('TENANT_CAPABILITY_DENIED');
    }
    if (
      configuration.allowedCapabilityIds &&
      !configuration.allowedCapabilityIds.includes(capabilityId)
    ) {
      throw new TenantIsolationError('TENANT_CAPABILITY_NOT_ALLOWED');
    }

    const provider = configuration.providers.find(
      (candidate) => candidate.providerId === input.providerId && candidate.enabled,
    );
    if (!provider) throw new TenantIsolationError('TENANT_PROVIDER_UNAVAILABLE');
    if (provider.allowedCapabilityIds && !provider.allowedCapabilityIds.includes(capabilityId)) {
      throw new TenantIsolationError('TENANT_PROVIDER_CAPABILITY_NOT_ALLOWED');
    }

    const credential = configuration.credentials.find(
      (candidate) =>
        candidate.credentialBindingId === provider.credentialBindingId && candidate.enabled,
    );
    if (!credential || credential.providerId !== provider.providerId) {
      throw new TenantIsolationError('TENANT_CREDENTIAL_UNAVAILABLE');
    }
    if (
      credential.allowedCapabilityIds &&
      !credential.allowedCapabilityIds.includes(capabilityId)
    ) {
      throw new TenantIsolationError('TENANT_CREDENTIAL_CAPABILITY_NOT_ALLOWED');
    }

    const connectedAccount = await this.connectedAccounts.get(provider.connectedAccountId);
    if (!connectedAccount || connectedAccount.provider !== provider.providerId) {
      throw new TenantIsolationError('TENANT_CONNECTED_ACCOUNT_UNAVAILABLE');
    }

    // Only the tenant-owned binding can select a SecretReference. Callers never pass secret keys.
    const secret = await this.secrets.resolve(credential.secretReference);
    return {
      providerId: provider.providerId,
      connectedAccount,
      secret,
      evidence: [...provider.evidence, ...credential.evidence, ...configuration.evidence],
    };
  }

  private async requireTenantConfiguration(identity: ExecutionIdentity): Promise<TenantConfiguration> {
    if (identity.authorization.tenantId !== identity.principal.tenantId) {
      throw new TenantIsolationError('AUTHORIZATION_TENANT_MISMATCH');
    }
    const configuration = await this.configurations.get(identity.principal.tenantId);
    if (!configuration) throw new TenantIsolationError('TENANT_CONFIGURATION_NOT_FOUND');
    const scope: TenantScope = {
      tenantId: identity.principal.tenantId,
      workspaceId: identity.principal.workspaceId,
      organizationId: identity.principal.organizationId,
    };
    assertSameTenantBoundary(scope, configuration);
    return configuration;
  }
}
