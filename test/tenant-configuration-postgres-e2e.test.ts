import { describe, expect, it } from 'vitest';
import { AUTHORIZATION_ROLES } from '../src/core/identity.js';
import { createPostgresPool } from '../src/persistence/postgres.js';
import { PostgresTenantConfigurationStore } from '../src/persistence/postgres-tenant-configuration-store.js';
import type { TenantConfiguration } from '../src/tenancy/contracts.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('TENANT_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

function configuration(tenantId: string, version = 1): TenantConfiguration {
  const principalId = `${tenantId}:principal`;
  const providerId = 'meta_ads';
  const connectedAccountId = `${tenantId}:meta-account`;
  const capabilityId = 'meta_ads.campaign.create_paused';
  return {
    tenantId,
    workspaceId: `${tenantId}:workspace`,
    organizationId: `${tenantId}:organization`,
    status: 'ACTIVE',
    displayName: `Tenant ${tenantId}`,
    allowedCapabilityIds: [capabilityId],
    deniedCapabilityIds: [],
    providers: [
      {
        providerId,
        connectedAccountId,
        credentialBindingId: `${tenantId}:credential`,
        enabled: true,
        allowedCapabilityIds: [capabilityId],
        evidence: [`${tenantId}:provider-evidence`],
      },
    ],
    credentials: [
      {
        credentialBindingId: `${tenantId}:credential`,
        providerId,
        secretReference: { provider: 'gcp-secret-manager', key: `${tenantId}:meta-token` },
        allowedCapabilityIds: [capabilityId],
        enabled: true,
        evidence: [`${tenantId}:credential-evidence`],
      },
    ],
    campaigns: [
      {
        providerId,
        connectedAccountId,
        campaignId: `${tenantId}:campaign`,
        evidence: [`${tenantId}:campaign-evidence`],
      },
    ],
    brandCreativeTruth: {
      brandResourceId: `${tenantId}:brand`,
      creativeTruthRegistryResourceId: `${tenantId}:creative-truth`,
      evidence: [`${tenantId}:brand-evidence`],
    },
    budgets: [
      {
        budgetId: `${tenantId}:budget`,
        currency: 'BRL',
        maxSingleOperationMinor: 50_000,
        allowedCapabilityIds: [capabilityId],
        evidence: [`${tenantId}:budget-evidence`],
      },
    ],
    policies: [
      {
        policyId: `${tenantId}:policy`,
        policyResourceId: `${tenantId}:policy-resource`,
        allowedRiskClasses: ['FINANCIAL_IMPACT'],
        evidence: [`${tenantId}:policy-evidence`],
      },
    ],
    approvalChains: [
      {
        approvalChainId: `${tenantId}:approval-chain`,
        approvalResourceId: `${tenantId}:approval-resource`,
        routeIds: ['R08'],
        capabilityIds: [capabilityId],
        evidence: [`${tenantId}:approval-evidence`],
      },
    ],
    rbacGrants: AUTHORIZATION_ROLES.map((role) => ({
      grantId: `${tenantId}:grant:${role}`,
      principalId,
      role,
      allowedRouteIds: ['R08'],
      allowedCapabilityIds: [capabilityId],
      allowedTargetAccounts: [connectedAccountId],
      enabled: true,
      evidence: [`${tenantId}:rbac:${role}`],
    })),
    assets: {
      assetRegistryResourceId: `${tenantId}:asset-registry`,
      evidence: [`${tenantId}:asset-evidence`],
    },
    analytics: {
      analyticsNamespace: `${tenantId}:analytics`,
      evidence: [`${tenantId}:analytics-evidence`],
    },
    quotas: [
      {
        quotaId: `${tenantId}:quota`,
        capabilityId,
        limit: 100,
        interval: 'DAY',
        evidence: [`${tenantId}:quota-evidence`],
      },
    ],
    version,
    evidence: [`${tenantId}:configuration-evidence`],
  };
}

postgresDescribe('tenant configuration PostgreSQL E2E', () => {
  it('persists complete tenant configuration across restart without leaking sibling tenant data', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantA = `tenant-a-${suffix}`;
    const tenantB = `tenant-b-${suffix}`;

    const pool1 = createPostgresPool({ connectionString: databaseUrl(), max: 3 });
    const store1 = new PostgresTenantConfigurationStore(pool1);
    await store1.put(configuration(tenantA));
    await store1.put(configuration(tenantB));
    await pool1.end();

    const pool2 = createPostgresPool({ connectionString: databaseUrl(), max: 3 });
    const store2 = new PostgresTenantConfigurationStore(pool2);
    const readA = await store2.get(tenantA);
    const readB = await store2.get(tenantB);

    expect(readA).toMatchObject({
      tenantId: tenantA,
      workspaceId: `${tenantA}:workspace`,
      organizationId: `${tenantA}:organization`,
      version: 1,
      assets: { assetRegistryResourceId: `${tenantA}:asset-registry` },
      analytics: { analyticsNamespace: `${tenantA}:analytics` },
    });
    expect(readA?.providers).toHaveLength(1);
    expect(readA?.credentials[0]?.secretReference).toEqual({
      provider: 'gcp-secret-manager',
      key: `${tenantA}:meta-token`,
    });
    expect(readA?.campaigns[0]?.campaignId).toBe(`${tenantA}:campaign`);
    expect(readA?.rbacGrants).toHaveLength(AUTHORIZATION_ROLES.length);
    expect(readA?.providers.some((binding) => binding.connectedAccountId.includes(tenantB))).toBe(
      false,
    );
    expect(
      readA?.credentials.some((binding) => binding.secretReference.key.includes(tenantB)),
    ).toBe(false);
    expect(readB?.tenantId).toBe(tenantB);
    await pool2.end();
  });

  it('rejects cross-tenant provider, secret, campaign, brand, policy and asset ownership reuse', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantA = `owner-a-${suffix}`;
    const tenantB = `owner-b-${suffix}`;
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 3 });
    const store = new PostgresTenantConfigurationStore(pool);
    const first = configuration(tenantA);
    await store.put(first);

    const secondBase = configuration(tenantB);
    const collision: TenantConfiguration = {
      ...secondBase,
      providers: first.providers.map((binding) => ({
        ...binding,
        credentialBindingId: secondBase.credentials[0]?.credentialBindingId ?? '',
      })),
      credentials: secondBase.credentials.map((binding) => ({
        ...binding,
        secretReference: first.credentials[0]?.secretReference ?? binding.secretReference,
      })),
      campaigns: first.campaigns.map((binding) => ({ ...binding })),
      brandCreativeTruth: { ...first.brandCreativeTruth },
      policies: first.policies.map((binding) => ({ ...binding })),
      approvalChains: first.approvalChains.map((binding) => ({ ...binding })),
      assets: { ...first.assets },
      analytics: { ...first.analytics },
    };

    await expect(store.put(collision)).rejects.toThrow('TENANT_RESOURCE_ALREADY_OWNED');
    expect(await store.get(tenantB)).toBeUndefined();
    await pool.end();
  });

  it('rejects a provider binding that tries to reference another tenant credential directly', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantA = `fk-a-${suffix}`;
    const tenantB = `fk-b-${suffix}`;
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 3 });
    const store = new PostgresTenantConfigurationStore(pool);
    await store.put(configuration(tenantA));
    await store.put(configuration(tenantB));

    await expect(
      pool.query(
        `insert into tenant_provider_bindings (
           tenant_id, provider_id, connected_account_id, credential_binding_id,
           enabled, allowed_capability_ids, evidence
         ) values ($1, 'instagram', $2, $3, true, null, '["cross-tenant-test"]'::jsonb)`,
        [tenantB, `${tenantB}:rogue-account`, `${tenantA}:credential`],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    await pool.end();
  });

  it('rejects stale configuration versions while permitting idempotent same-version retry', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantId = `version-${suffix}`;
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 3 });
    const store = new PostgresTenantConfigurationStore(pool);

    await store.put(configuration(tenantId, 2));
    await store.put(configuration(tenantId, 2));
    await expect(store.put(configuration(tenantId, 1))).rejects.toThrow(
      'TENANT_CONFIGURATION_VERSION_STALE',
    );
    expect((await store.get(tenantId))?.version).toBe(2);

    await pool.end();
  });
});
