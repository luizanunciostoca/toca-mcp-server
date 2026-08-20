import { describe, expect, it } from 'vitest';
import { InMemoryConnectedAccountStore } from '../src/core/connected-account-store.js';
import {
  AUTHORIZATION_ROLES,
  createTrustedServiceExecutionIdentity,
  type AuthorizationRole,
} from '../src/core/identity.js';
import { InMemorySecretStore, type SecretReference } from '../src/core/secrets.js';
import type { TenantConfiguration } from '../src/tenancy/contracts.js';
import {
  authorizeTenantResourceAccess,
  TenantCapabilityAvailabilityResolver,
} from '../src/tenancy/tenant-boundary.js';
import { InMemoryTenantConfigurationStore } from '../src/tenancy/tenant-configuration.js';
import { TenantCredentialResolver } from '../src/tenancy/tenant-credential-resolver.js';
import { TenantPolicyOverlay } from '../src/tenancy/tenant-policy.js';
import { authorizeTenantRbac } from '../src/tenancy/tenant-rbac.js';
import { TenantRegistryResolver } from '../src/tenancy/tenant-registry-resolver.js';

const WRITE_CAPABILITY = 'instagram.media.publish';
const FINANCIAL_CAPABILITY = 'meta_ads.campaign.create_paused';

interface ConfigurationOptions {
  readonly tenantId: string;
  readonly allowedCapabilityIds?: readonly string[] | null;
  readonly provider?: {
    readonly providerId: string;
    readonly connectedAccountId: string;
    readonly secretReference: SecretReference;
  };
  readonly campaignId?: string;
  readonly budgetMinor?: number;
}

function tenantConfiguration(options: ConfigurationOptions): TenantConfiguration {
  const tenant = options.tenantId;
  const provider = options.provider;
  return {
    tenantId: tenant,
    workspaceId: `${tenant}-workspace`,
    organizationId: `${tenant}-organization`,
    status: 'ACTIVE',
    displayName: `Tenant ${tenant}`,
    allowedCapabilityIds: options.allowedCapabilityIds ?? null,
    deniedCapabilityIds: [],
    providers: provider
      ? [
          {
            providerId: provider.providerId,
            connectedAccountId: provider.connectedAccountId,
            credentialBindingId: `${tenant}-credential`,
            enabled: true,
            allowedCapabilityIds: [WRITE_CAPABILITY],
            evidence: [`${tenant}:provider-binding`],
          },
        ]
      : [],
    credentials: provider
      ? [
          {
            credentialBindingId: `${tenant}-credential`,
            providerId: provider.providerId,
            secretReference: provider.secretReference,
            allowedCapabilityIds: [WRITE_CAPABILITY],
            enabled: true,
            evidence: [`${tenant}:credential-binding`],
          },
        ]
      : [],
    campaigns:
      provider && options.campaignId
        ? [
            {
              providerId: provider.providerId,
              connectedAccountId: provider.connectedAccountId,
              campaignId: options.campaignId,
              evidence: [`${tenant}:campaign`],
            },
          ]
        : [],
    brandCreativeTruth: {
      brandResourceId: `${tenant}:brand`,
      creativeTruthRegistryResourceId: `${tenant}:creative-truth`,
      evidence: [`${tenant}:brand-creative-truth`],
    },
    budgets:
      options.budgetMinor === undefined
        ? []
        : [
            {
              budgetId: `${tenant}:budget`,
              currency: 'BRL',
              maxSingleOperationMinor: options.budgetMinor,
              allowedCapabilityIds: [FINANCIAL_CAPABILITY],
              evidence: [`${tenant}:budget`],
            },
          ],
    policies: [
      {
        policyId: `${tenant}:policy`,
        policyResourceId: `${tenant}:policy-resource`,
        allowedRiskClasses: null,
        evidence: [`${tenant}:policy`],
      },
    ],
    approvalChains: [
      {
        approvalChainId: `${tenant}:approval-chain`,
        approvalResourceId: `${tenant}:approval-resource`,
        routeIds: null,
        capabilityIds: null,
        evidence: [`${tenant}:approval-chain`],
      },
    ],
    rbacGrants: AUTHORIZATION_ROLES.map((role) => ({
      grantId: `${tenant}:${role.toLowerCase()}`,
      principalId: `${tenant}:principal`,
      role,
      allowedRouteIds: null,
      allowedCapabilityIds: null,
      allowedTargetAccounts: null,
      enabled: true,
      evidence: [`${tenant}:rbac:${role}`],
    })),
    assets: {
      assetRegistryResourceId: `${tenant}:asset-registry`,
      evidence: [`${tenant}:asset-registry`],
    },
    analytics: {
      analyticsNamespace: `${tenant}:analytics`,
      evidence: [`${tenant}:analytics`],
    },
    quotas: [],
    version: 1,
    evidence: [`${tenant}:configuration`],
  };
}

function identity(
  tenantId: string,
  roles: readonly AuthorizationRole[] = ['ADMIN'],
  principalId = `${tenantId}:principal`,
) {
  return createTrustedServiceExecutionIdentity({
    principalId,
    tenantId,
    workspaceId: `${tenantId}-workspace`,
    organizationId: `${tenantId}-organization`,
    roles,
    allowedRouteIds: null,
    allowedCapabilityIds: null,
    allowedTargetAccounts: null,
    evidence: [`${tenantId}:identity`],
    now: '2026-08-20T05:00:00.000Z',
  });
}

describe('tenant isolation', () => {
  it('denies cross-tenant resource access even to an ADMIN', () => {
    const decision = authorizeTenantResourceAccess(
      identity('tenant-a'),
      {
        resourceId: 'tenant-b:asset',
        tenantId: 'tenant-b',
        workspaceId: 'tenant-b-workspace',
        organizationId: 'tenant-b-organization',
      },
      { capabilityId: 'system.health', riskClass: 'READ' },
    );

    expect(decision).toMatchObject({ allowed: false, reason: 'TENANT_SCOPE_MISMATCH' });
  });

  it('requires a tenant-specific RBAC grant even for a same-tenant authenticated principal', () => {
    const configuration = tenantConfiguration({ tenantId: 'tenant-a' });
    const decision = authorizeTenantRbac(
      configuration,
      identity('tenant-a', ['ADMIN'], 'tenant-a:ungranted-principal'),
      { capabilityId: 'system.health', riskClass: 'READ' },
    );

    expect(decision).toMatchObject({ allowed: false, reason: 'TENANT_RBAC_GRANT_REQUIRED' });
  });

  it('rejects exclusive provider account and secret ownership across tenants', async () => {
    const secrets = new InMemorySecretStore();
    const firstSecret = await secrets.put('tenant-a-token', 'secret-a');
    const secondSecret = await secrets.put('tenant-b-token', 'secret-b');
    const store = new InMemoryTenantConfigurationStore();

    await store.put(
      tenantConfiguration({
        tenantId: 'tenant-a',
        provider: {
          providerId: 'instagram',
          connectedAccountId: 'instagram-account-a',
          secretReference: firstSecret,
        },
      }),
    );

    await expect(
      store.put(
        tenantConfiguration({
          tenantId: 'tenant-b',
          provider: {
            providerId: 'instagram',
            connectedAccountId: 'instagram-account-a',
            secretReference: secondSecret,
          },
        }),
      ),
    ).rejects.toThrow('TENANT_RESOURCE_ALREADY_OWNED');

    const secretReuseStore = new InMemoryTenantConfigurationStore();
    await secretReuseStore.put(
      tenantConfiguration({
        tenantId: 'tenant-a',
        provider: {
          providerId: 'instagram',
          connectedAccountId: 'instagram-account-a',
          secretReference: firstSecret,
        },
      }),
    );
    await expect(
      secretReuseStore.put(
        tenantConfiguration({
          tenantId: 'tenant-b',
          provider: {
            providerId: 'instagram',
            connectedAccountId: 'instagram-account-b',
            secretReference: firstSecret,
          },
        }),
      ),
    ).rejects.toThrow('TENANT_RESOURCE_ALREADY_OWNED');
  });

  it('resolves only the identity tenant provider account and secret', async () => {
    const secrets = new InMemorySecretStore();
    const tenantASecret = await secrets.put('tenant-a-token', 'secret-a');
    const tenantBSecret = await secrets.put('tenant-b-token', 'secret-b');
    const configurations = new InMemoryTenantConfigurationStore();
    await configurations.put(
      tenantConfiguration({
        tenantId: 'tenant-a',
        allowedCapabilityIds: [WRITE_CAPABILITY],
        provider: {
          providerId: 'instagram',
          connectedAccountId: 'instagram-account-a',
          secretReference: tenantASecret,
        },
      }),
    );
    await configurations.put(
      tenantConfiguration({
        tenantId: 'tenant-b',
        allowedCapabilityIds: [WRITE_CAPABILITY],
        provider: {
          providerId: 'instagram',
          connectedAccountId: 'instagram-account-b',
          secretReference: tenantBSecret,
        },
      }),
    );

    const accounts = new InMemoryConnectedAccountStore();
    await accounts.save({
      id: 'instagram-account-a',
      provider: 'instagram',
      externalAccountId: 'external-a',
      label: 'Tenant A Instagram',
      scopes: ['publish'],
      status: 'CONNECTED',
      tokenReference: 'opaque-a',
    });
    await accounts.save({
      id: 'instagram-account-b',
      provider: 'instagram',
      externalAccountId: 'external-b',
      label: 'Tenant B Instagram',
      scopes: ['publish'],
      status: 'CONNECTED',
      tokenReference: 'opaque-b',
    });

    const resolver = new TenantCredentialResolver(configurations, accounts, secrets);
    const access = await resolver.resolve({
      identity: identity('tenant-a'),
      providerId: 'instagram',
      expectation: { capabilityId: WRITE_CAPABILITY, riskClass: 'WRITE_EXTERNAL' },
    });

    expect(access.connectedAccount.id).toBe('instagram-account-a');
    expect(access.secret).toBe('secret-a');

    await expect(
      resolver.resolve({
        identity: identity('tenant-a', ['READER']),
        providerId: 'instagram',
        expectation: { capabilityId: WRITE_CAPABILITY, riskClass: 'WRITE_EXTERNAL' },
      }),
    ).rejects.toThrow();

    await expect(
      resolver.resolve({
        identity: identity('tenant-a', ['ADMIN'], 'tenant-a:ungranted-principal'),
        providerId: 'instagram',
        expectation: { capabilityId: WRITE_CAPABILITY, riskClass: 'WRITE_EXTERNAL' },
      }),
    ).rejects.toThrow('TENANT_RBAC_GRANT_REQUIRED');
  });

  it('does not allow a tenant to consume another tenant budget', async () => {
    const configurations = new InMemoryTenantConfigurationStore();
    await configurations.put(
      tenantConfiguration({
        tenantId: 'tenant-a',
        allowedCapabilityIds: [FINANCIAL_CAPABILITY],
        budgetMinor: 100,
      }),
    );
    await configurations.put(
      tenantConfiguration({
        tenantId: 'tenant-b',
        allowedCapabilityIds: [FINANCIAL_CAPABILITY],
        budgetMinor: 100_000,
      }),
    );

    const overlay = new TenantPolicyOverlay(configurations);
    const decision = await overlay.evaluate(identity('tenant-a', ['FINANCIAL_OPERATOR']), {
      capabilityId: FINANCIAL_CAPABILITY,
      riskClass: 'FINANCIAL_IMPACT',
      requestedBudgetMinor: 101,
      currency: 'BRL',
    });

    expect(decision).toMatchObject({ allowed: false, reason: 'TENANT_BUDGET_LIMIT_EXCEEDED' });
  });

  it('resolves capability, assets, analytics and campaigns only from the identity tenant', async () => {
    const configurations = new InMemoryTenantConfigurationStore();
    await configurations.put(
      tenantConfiguration({
        tenantId: 'tenant-a',
        allowedCapabilityIds: ['system.health'],
        provider: {
          providerId: 'meta_ads',
          connectedAccountId: 'meta-account-a',
          secretReference: { provider: 'memory', key: 'meta-a' },
        },
        campaignId: 'campaign-a',
      }),
    );
    await configurations.put(
      tenantConfiguration({
        tenantId: 'tenant-b',
        allowedCapabilityIds: ['other.capability'],
        provider: {
          providerId: 'meta_ads',
          connectedAccountId: 'meta-account-b',
          secretReference: { provider: 'memory', key: 'meta-b' },
        },
        campaignId: 'campaign-b',
      }),
    );

    const availability = new TenantCapabilityAvailabilityResolver(configurations);
    await expect(
      availability.resolve({ identity: identity('tenant-a'), capabilityId: 'other.capability' }),
    ).resolves.toMatchObject({ available: false, reason: 'TENANT_CAPABILITY_NOT_ALLOWED' });

    const registries = new TenantRegistryResolver(configurations);
    await expect(registries.resolveAssetRegistry(identity('tenant-a'))).resolves.toMatchObject({
      assetRegistryResourceId: 'tenant-a:asset-registry',
    });
    await expect(registries.resolveAnalytics(identity('tenant-a'))).resolves.toMatchObject({
      analyticsNamespace: 'tenant-a:analytics',
    });
    await expect(
      registries.resolveCampaign(identity('tenant-a'), 'meta_ads', 'campaign-a'),
    ).resolves.toMatchObject({ campaignId: 'campaign-a', connectedAccountId: 'meta-account-a' });
    await expect(
      registries.resolveCampaign(identity('tenant-a'), 'meta_ads', 'campaign-b'),
    ).rejects.toThrow('TENANT_CAMPAIGN_NOT_OWNED');
  });
});
