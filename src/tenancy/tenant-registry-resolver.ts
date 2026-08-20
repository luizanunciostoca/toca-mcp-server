import type { ExecutionIdentity } from '../core/identity.js';
import type {
  TenantCampaignBinding,
  TenantConfiguration,
  TenantConfigurationStore,
  TenantQuota,
  TenantScope,
} from './contracts.js';
import { assertSameTenantBoundary, TenantIsolationError } from './tenant-configuration.js';

export interface ResolvedTenantBrandCreativeTruth {
  readonly brandResourceId: string;
  readonly creativeTruthRegistryResourceId: string;
  readonly evidence: readonly string[];
}

export interface ResolvedTenantAssetRegistry {
  readonly assetRegistryResourceId: string;
  readonly evidence: readonly string[];
}

export interface ResolvedTenantAnalytics {
  readonly analyticsNamespace: string;
  readonly evidence: readonly string[];
}

export class TenantRegistryResolver {
  constructor(private readonly configurations: TenantConfigurationStore) {}

  async resolveBrandCreativeTruth(
    identity: ExecutionIdentity,
  ): Promise<ResolvedTenantBrandCreativeTruth> {
    const configuration = await this.requireActiveConfiguration(identity);
    return {
      brandResourceId: configuration.brandCreativeTruth.brandResourceId,
      creativeTruthRegistryResourceId:
        configuration.brandCreativeTruth.creativeTruthRegistryResourceId,
      evidence: [...configuration.brandCreativeTruth.evidence, ...configuration.evidence],
    };
  }

  async resolveAssetRegistry(identity: ExecutionIdentity): Promise<ResolvedTenantAssetRegistry> {
    const configuration = await this.requireActiveConfiguration(identity);
    return {
      assetRegistryResourceId: configuration.assets.assetRegistryResourceId,
      evidence: [...configuration.assets.evidence, ...configuration.evidence],
    };
  }

  async resolveAnalytics(identity: ExecutionIdentity): Promise<ResolvedTenantAnalytics> {
    const configuration = await this.requireActiveConfiguration(identity);
    return {
      analyticsNamespace: configuration.analytics.analyticsNamespace,
      evidence: [...configuration.analytics.evidence, ...configuration.evidence],
    };
  }

  async resolveCampaign(
    identity: ExecutionIdentity,
    providerId: string,
    campaignId: string,
  ): Promise<TenantCampaignBinding> {
    const configuration = await this.requireActiveConfiguration(identity);
    const campaign = configuration.campaigns.find(
      (candidate) => candidate.providerId === providerId && candidate.campaignId === campaignId,
    );
    if (!campaign) throw new TenantIsolationError('TENANT_CAMPAIGN_NOT_OWNED');
    return campaign;
  }

  async resolveQuota(
    identity: ExecutionIdentity,
    capabilityId: string,
  ): Promise<readonly TenantQuota[]> {
    const configuration = await this.requireActiveConfiguration(identity);
    return configuration.quotas
      .filter((quota) => quota.capabilityId === capabilityId)
      .sort((left, right) => left.quotaId.localeCompare(right.quotaId));
  }

  private async requireActiveConfiguration(
    identity: ExecutionIdentity,
  ): Promise<TenantConfiguration> {
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
    if (configuration.status !== 'ACTIVE') throw new TenantIsolationError('TENANT_SUSPENDED');
    return configuration;
  }
}
