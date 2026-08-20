import type { TenantConfiguration, TenantConfigurationStore, TenantScope } from './contracts.js';

export class TenantIsolationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'TenantIsolationError';
  }
}

export function assertTenantScope(scope: TenantScope): void {
  requireNonEmpty(scope.tenantId, 'TENANT_ID_REQUIRED');
  requireNonEmpty(scope.workspaceId, 'TENANT_WORKSPACE_REQUIRED');
  requireNonEmpty(scope.organizationId, 'TENANT_ORGANIZATION_REQUIRED');
}

export function assertSameTenantBoundary(expected: TenantScope, actual: TenantScope): void {
  assertTenantScope(expected);
  assertTenantScope(actual);
  if (expected.tenantId !== actual.tenantId) {
    throw new TenantIsolationError('TENANT_SCOPE_MISMATCH');
  }
  if (expected.workspaceId !== actual.workspaceId) {
    throw new TenantIsolationError('TENANT_WORKSPACE_MISMATCH');
  }
  if (expected.organizationId !== actual.organizationId) {
    throw new TenantIsolationError('TENANT_ORGANIZATION_MISMATCH');
  }
}

export function validateTenantConfiguration(configuration: TenantConfiguration): void {
  assertTenantScope(configuration);
  requireNonEmpty(configuration.displayName, 'TENANT_DISPLAY_NAME_REQUIRED');
  if (!Number.isInteger(configuration.version) || configuration.version < 1) {
    throw new TenantIsolationError('TENANT_CONFIGURATION_VERSION_INVALID');
  }
  requireEvidence(configuration.evidence, 'TENANT_CONFIGURATION_EVIDENCE_REQUIRED');
  requireNonEmpty(
    configuration.brandCreativeTruth.brandResourceId,
    'TENANT_BRAND_RESOURCE_REQUIRED',
  );
  requireNonEmpty(
    configuration.brandCreativeTruth.creativeTruthRegistryResourceId,
    'TENANT_CREATIVE_TRUTH_REGISTRY_REQUIRED',
  );
  requireEvidence(
    configuration.brandCreativeTruth.evidence,
    'TENANT_BRAND_CREATIVE_TRUTH_EVIDENCE_REQUIRED',
  );
  requireNonEmpty(configuration.assets.assetRegistryResourceId, 'TENANT_ASSET_REGISTRY_REQUIRED');
  requireEvidence(configuration.assets.evidence, 'TENANT_ASSET_REGISTRY_EVIDENCE_REQUIRED');
  requireNonEmpty(
    configuration.analytics.analyticsNamespace,
    'TENANT_ANALYTICS_NAMESPACE_REQUIRED',
  );
  requireEvidence(configuration.analytics.evidence, 'TENANT_ANALYTICS_EVIDENCE_REQUIRED');

  const providerIds = new Set<string>();
  for (const provider of configuration.providers) {
    requireNonEmpty(provider.providerId, 'TENANT_PROVIDER_ID_REQUIRED');
    requireNonEmpty(provider.connectedAccountId, 'TENANT_CONNECTED_ACCOUNT_REQUIRED');
    requireNonEmpty(provider.credentialBindingId, 'TENANT_PROVIDER_CREDENTIAL_REQUIRED');
    requireEvidence(provider.evidence, 'TENANT_PROVIDER_EVIDENCE_REQUIRED');
    if (providerIds.has(provider.providerId)) {
      throw new TenantIsolationError('TENANT_PROVIDER_DUPLICATE');
    }
    providerIds.add(provider.providerId);
  }

  const credentialIds = new Set<string>();
  for (const credential of configuration.credentials) {
    requireNonEmpty(credential.credentialBindingId, 'TENANT_CREDENTIAL_ID_REQUIRED');
    requireNonEmpty(credential.providerId, 'TENANT_CREDENTIAL_PROVIDER_REQUIRED');
    requireNonEmpty(credential.secretReference.provider, 'TENANT_SECRET_PROVIDER_REQUIRED');
    requireNonEmpty(credential.secretReference.key, 'TENANT_SECRET_KEY_REQUIRED');
    requireEvidence(credential.evidence, 'TENANT_CREDENTIAL_EVIDENCE_REQUIRED');
    if (credentialIds.has(credential.credentialBindingId)) {
      throw new TenantIsolationError('TENANT_CREDENTIAL_DUPLICATE');
    }
    credentialIds.add(credential.credentialBindingId);
  }

  for (const provider of configuration.providers) {
    const credential = configuration.credentials.find(
      (candidate) => candidate.credentialBindingId === provider.credentialBindingId,
    );
    if (!credential || credential.providerId !== provider.providerId) {
      throw new TenantIsolationError('TENANT_PROVIDER_CREDENTIAL_MISMATCH');
    }
  }

  const campaignIds = new Set<string>();
  for (const campaign of configuration.campaigns) {
    requireNonEmpty(campaign.providerId, 'TENANT_CAMPAIGN_PROVIDER_REQUIRED');
    requireNonEmpty(campaign.connectedAccountId, 'TENANT_CAMPAIGN_ACCOUNT_REQUIRED');
    requireNonEmpty(campaign.campaignId, 'TENANT_CAMPAIGN_ID_REQUIRED');
    requireEvidence(campaign.evidence, 'TENANT_CAMPAIGN_EVIDENCE_REQUIRED');
    const provider = configuration.providers.find(
      (candidate) =>
        candidate.providerId === campaign.providerId &&
        candidate.connectedAccountId === campaign.connectedAccountId,
    );
    if (!provider) throw new TenantIsolationError('TENANT_CAMPAIGN_PROVIDER_MISMATCH');
    const campaignKey = `${campaign.providerId}:${campaign.connectedAccountId}:${campaign.campaignId}`;
    if (campaignIds.has(campaignKey)) throw new TenantIsolationError('TENANT_CAMPAIGN_DUPLICATE');
    campaignIds.add(campaignKey);
  }

  for (const budget of configuration.budgets) {
    requireNonEmpty(budget.budgetId, 'TENANT_BUDGET_ID_REQUIRED');
    if (!/^[A-Z]{3}$/.test(budget.currency)) {
      throw new TenantIsolationError('TENANT_BUDGET_CURRENCY_INVALID');
    }
    if (
      !Number.isSafeInteger(budget.maxSingleOperationMinor) ||
      budget.maxSingleOperationMinor < 0
    ) {
      throw new TenantIsolationError('TENANT_BUDGET_LIMIT_INVALID');
    }
    requireEvidence(budget.evidence, 'TENANT_BUDGET_EVIDENCE_REQUIRED');
  }

  for (const policy of configuration.policies) {
    requireNonEmpty(policy.policyId, 'TENANT_POLICY_ID_REQUIRED');
    requireNonEmpty(policy.policyResourceId, 'TENANT_POLICY_RESOURCE_REQUIRED');
    requireEvidence(policy.evidence, 'TENANT_POLICY_EVIDENCE_REQUIRED');
  }

  for (const approvalChain of configuration.approvalChains) {
    requireNonEmpty(approvalChain.approvalChainId, 'TENANT_APPROVAL_CHAIN_ID_REQUIRED');
    requireNonEmpty(approvalChain.approvalResourceId, 'TENANT_APPROVAL_RESOURCE_REQUIRED');
    requireEvidence(approvalChain.evidence, 'TENANT_APPROVAL_EVIDENCE_REQUIRED');
  }

  const rbacGrantIds = new Set<string>();
  for (const grant of configuration.rbacGrants) {
    requireNonEmpty(grant.grantId, 'TENANT_RBAC_GRANT_ID_REQUIRED');
    requireNonEmpty(grant.principalId, 'TENANT_RBAC_PRINCIPAL_REQUIRED');
    requireEvidence(grant.evidence, 'TENANT_RBAC_EVIDENCE_REQUIRED');
    if (rbacGrantIds.has(grant.grantId)) {
      throw new TenantIsolationError('TENANT_RBAC_GRANT_DUPLICATE');
    }
    rbacGrantIds.add(grant.grantId);
  }

  for (const quota of configuration.quotas) {
    requireNonEmpty(quota.quotaId, 'TENANT_QUOTA_ID_REQUIRED');
    requireNonEmpty(quota.capabilityId, 'TENANT_QUOTA_CAPABILITY_REQUIRED');
    if (!Number.isSafeInteger(quota.limit) || quota.limit < 0) {
      throw new TenantIsolationError('TENANT_QUOTA_LIMIT_INVALID');
    }
    requireEvidence(quota.evidence, 'TENANT_QUOTA_EVIDENCE_REQUIRED');
  }
}

export class InMemoryTenantConfigurationStore implements TenantConfigurationStore {
  readonly #configurations = new Map<string, TenantConfiguration>();
  readonly #resourceOwners = new Map<string, string>();

  get(tenantId: string): Promise<TenantConfiguration | undefined> {
    requireNonEmpty(tenantId, 'TENANT_ID_REQUIRED');
    return Promise.resolve(this.#configurations.get(tenantId));
  }

  put(configuration: TenantConfiguration): Promise<void> {
    return Promise.resolve().then(() => {
      validateTenantConfiguration(configuration);
      const resourceKeys = ownedResourceKeys(configuration);
      for (const resourceKey of resourceKeys) {
        const owner = this.#resourceOwners.get(resourceKey);
        if (owner && owner !== configuration.tenantId) {
          throw new TenantIsolationError('TENANT_RESOURCE_ALREADY_OWNED');
        }
      }

      const previous = this.#configurations.get(configuration.tenantId);
      if (previous) {
        for (const resourceKey of ownedResourceKeys(previous)) {
          if (this.#resourceOwners.get(resourceKey) === configuration.tenantId) {
            this.#resourceOwners.delete(resourceKey);
          }
        }
      }
      for (const resourceKey of resourceKeys) {
        this.#resourceOwners.set(resourceKey, configuration.tenantId);
      }
      this.#configurations.set(configuration.tenantId, configuration);
    });
  }
}

function ownedResourceKeys(configuration: TenantConfiguration): readonly string[] {
  const keys = new Set<string>([
    `brand:${configuration.brandCreativeTruth.brandResourceId}`,
    `creative-truth:${configuration.brandCreativeTruth.creativeTruthRegistryResourceId}`,
    `asset-registry:${configuration.assets.assetRegistryResourceId}`,
    `analytics:${configuration.analytics.analyticsNamespace}`,
  ]);
  for (const provider of configuration.providers) {
    keys.add(`provider-account:${provider.providerId}:${provider.connectedAccountId}`);
  }
  for (const credential of configuration.credentials) {
    keys.add(`secret:${credential.secretReference.provider}:${credential.secretReference.key}`);
  }
  for (const campaign of configuration.campaigns) {
    keys.add(
      `campaign:${campaign.providerId}:${campaign.connectedAccountId}:${campaign.campaignId}`,
    );
  }
  for (const policy of configuration.policies) {
    keys.add(`policy:${policy.policyResourceId}`);
  }
  for (const approvalChain of configuration.approvalChains) {
    keys.add(`approval:${approvalChain.approvalResourceId}`);
  }
  return [...keys].sort();
}

function requireNonEmpty(value: string, code: string): string {
  if (!value.trim()) throw new TenantIsolationError(code);
  return value;
}

function requireEvidence(evidence: readonly string[], code: string): void {
  if (evidence.length === 0 || evidence.some((entry) => !entry.trim())) {
    throw new TenantIsolationError(code);
  }
}
