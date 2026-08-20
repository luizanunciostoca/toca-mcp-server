import type pg from 'pg';
import { AUTHORIZATION_ROLES, type AuthorizationRole } from '../core/identity.js';
import type { RiskClass } from '../core/tool-registry.js';
import { isRouteId, type RouteId } from '../governance/types.js';
import {
  TENANT_STATUSES,
  type TenantApprovalChainBinding,
  type TenantBudgetEnvelope,
  type TenantCampaignBinding,
  type TenantConfiguration,
  type TenantConfigurationStore,
  type TenantCredentialBinding,
  type TenantPolicyBinding,
  type TenantProviderBinding,
  type TenantQuota,
  type TenantRbacGrant,
  type TenantStatus,
} from '../tenancy/contracts.js';
import {
  TenantIsolationError,
  validateTenantConfiguration,
} from '../tenancy/tenant-configuration.js';

interface TenantRootRow {
  readonly tenant_id: string;
  readonly status: string;
  readonly display_name: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly config_version: number;
  readonly allowed_capability_ids: unknown;
  readonly denied_capability_ids: unknown;
  readonly brand_resource_id: string;
  readonly creative_truth_registry_resource_id: string;
  readonly asset_registry_resource_id: string;
  readonly analytics_namespace: string;
  readonly evidence: unknown;
}

interface CredentialRow {
  readonly credential_binding_id: string;
  readonly provider_id: string;
  readonly secret_provider: string;
  readonly secret_key_reference: string;
  readonly enabled: boolean;
  readonly allowed_capability_ids: unknown;
  readonly evidence: unknown;
}

interface ProviderRow {
  readonly provider_id: string;
  readonly connected_account_id: string;
  readonly credential_binding_id: string;
  readonly enabled: boolean;
  readonly allowed_capability_ids: unknown;
  readonly evidence: unknown;
}

interface CampaignRow {
  readonly provider_id: string;
  readonly connected_account_id: string;
  readonly campaign_id: string;
  readonly evidence: unknown;
}

interface BudgetRow {
  readonly budget_id: string;
  readonly currency: string;
  readonly max_single_operation_minor: string | number;
  readonly allowed_capability_ids: unknown;
  readonly evidence: unknown;
}

interface PolicyRow {
  readonly policy_id: string;
  readonly policy_resource_id: string;
  readonly allowed_risk_classes: unknown;
  readonly evidence: unknown;
}

interface ApprovalRow {
  readonly approval_chain_id: string;
  readonly approval_resource_id: string;
  readonly route_ids: unknown;
  readonly capability_ids: unknown;
  readonly evidence: unknown;
}

interface RbacRow {
  readonly grant_id: string;
  readonly principal_id: string;
  readonly role: string;
  readonly allowed_route_ids: unknown;
  readonly allowed_capability_ids: unknown;
  readonly allowed_target_accounts: unknown;
  readonly enabled: boolean;
  readonly evidence: unknown;
}

interface AssetRow {
  readonly asset_registry_resource_id: string;
  readonly evidence: unknown;
}

interface AnalyticsRow {
  readonly analytics_namespace: string;
  readonly evidence: unknown;
}

interface QuotaRow {
  readonly quota_id: string;
  readonly capability_id: string;
  readonly quota_limit: string | number;
  readonly quota_interval: string;
  readonly evidence: unknown;
}

const RISK_CLASSES = [
  'READ',
  'WRITE_REVERSIBLE',
  'WRITE_EXTERNAL',
  'FINANCIAL_IMPACT',
  'DESTRUCTIVE',
] as const satisfies readonly RiskClass[];

export class PostgresTenantConfigurationStore implements TenantConfigurationStore {
  constructor(private readonly pool: pg.Pool) {}

  async get(tenantId: string): Promise<TenantConfiguration | undefined> {
    if (!tenantId.trim()) throw new TenantIsolationError('TENANT_ID_REQUIRED');
    const client = await this.pool.connect();
    try {
      await client.query('begin transaction isolation level repeatable read read only');
      const rootResult = await client.query(
        `select
           t.tenant_id, t.status, t.display_name,
           c.workspace_id, c.organization_id, c.config_version,
           c.allowed_capability_ids, c.denied_capability_ids,
           c.brand_resource_id, c.creative_truth_registry_resource_id,
           c.asset_registry_resource_id, c.analytics_namespace,
           c.evidence
         from tenants t
         join tenant_configurations c on c.tenant_id = t.tenant_id
         where t.tenant_id = $1`,
        [tenantId],
      );
      const root = rootResult.rows[0] as TenantRootRow | undefined;
      if (!root) {
        await client.query('commit');
        return undefined;
      }

      const credentials = await this.readCredentials(client, tenantId);
      const providers = await this.readProviders(client, tenantId);
      const campaigns = await this.readCampaigns(client, tenantId);
      const budgets = await this.readBudgets(client, tenantId);
      const policies = await this.readPolicies(client, tenantId);
      const approvalChains = await this.readApprovalChains(client, tenantId);
      const rbacGrants = await this.readRbacGrants(client, tenantId);
      const assets = await this.readAssetBinding(client, tenantId, root);
      const analytics = await this.readAnalyticsBinding(client, tenantId, root);
      const quotas = await this.readQuotas(client, tenantId);
      const evidence = stringArray(root.evidence, 'TENANT_CONFIGURATION_EVIDENCE_INVALID');

      const configuration: TenantConfiguration = {
        tenantId: root.tenant_id,
        workspaceId: root.workspace_id,
        organizationId: root.organization_id,
        status: tenantStatus(root.status),
        displayName: root.display_name,
        allowedCapabilityIds: nullableStringArray(
          root.allowed_capability_ids,
          'TENANT_ALLOWED_CAPABILITIES_INVALID',
        ),
        deniedCapabilityIds: stringArray(
          root.denied_capability_ids,
          'TENANT_DENIED_CAPABILITIES_INVALID',
        ),
        providers,
        credentials,
        campaigns,
        brandCreativeTruth: {
          brandResourceId: root.brand_resource_id,
          creativeTruthRegistryResourceId: root.creative_truth_registry_resource_id,
          evidence,
        },
        budgets,
        policies,
        approvalChains,
        rbacGrants,
        assets,
        analytics,
        quotas,
        version: root.config_version,
        evidence,
      };
      validateTenantConfiguration(configuration);
      await client.query('commit');
      return configuration;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async put(configuration: TenantConfiguration): Promise<void> {
    validateTenantConfiguration(configuration);
    const client = await this.pool.connect();
    try {
      await client.query('begin transaction isolation level serializable');
      const versionResult = await client.query(
        'select config_version from tenant_configurations where tenant_id = $1 for update',
        [configuration.tenantId],
      );
      const currentVersion = (versionResult.rows[0] as { config_version: number } | undefined)
        ?.config_version;
      if (currentVersion !== undefined && configuration.version < currentVersion) {
        throw new TenantIsolationError('TENANT_CONFIGURATION_VERSION_STALE');
      }

      await client.query(
        `insert into tenants (tenant_id, status, display_name, evidence, created_at, updated_at)
         values ($1, $2, $3, $4::jsonb, now(), now())
         on conflict (tenant_id) do update set
           status = excluded.status,
           display_name = excluded.display_name,
           evidence = excluded.evidence,
           updated_at = now()`,
        [
          configuration.tenantId,
          configuration.status,
          configuration.displayName,
          JSON.stringify(configuration.evidence),
        ],
      );
      await client.query(
        `insert into tenant_configurations (
           tenant_id, workspace_id, organization_id, config_version,
           allowed_capability_ids, denied_capability_ids,
           brand_resource_id, creative_truth_registry_resource_id,
           asset_registry_resource_id, analytics_namespace, evidence,
           created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11::jsonb, now(), now()
         ) on conflict (tenant_id) do update set
           workspace_id = excluded.workspace_id,
           organization_id = excluded.organization_id,
           config_version = excluded.config_version,
           allowed_capability_ids = excluded.allowed_capability_ids,
           denied_capability_ids = excluded.denied_capability_ids,
           brand_resource_id = excluded.brand_resource_id,
           creative_truth_registry_resource_id = excluded.creative_truth_registry_resource_id,
           asset_registry_resource_id = excluded.asset_registry_resource_id,
           analytics_namespace = excluded.analytics_namespace,
           evidence = excluded.evidence,
           updated_at = now()`,
        [
          configuration.tenantId,
          configuration.workspaceId,
          configuration.organizationId,
          configuration.version,
          nullableJson(configuration.allowedCapabilityIds),
          JSON.stringify(configuration.deniedCapabilityIds),
          configuration.brandCreativeTruth.brandResourceId,
          configuration.brandCreativeTruth.creativeTruthRegistryResourceId,
          configuration.assets.assetRegistryResourceId,
          configuration.analytics.analyticsNamespace,
          JSON.stringify(configuration.evidence),
        ],
      );

      await this.replaceChildren(client, configuration);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) {
        throw new TenantIsolationError('TENANT_RESOURCE_ALREADY_OWNED');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async replaceChildren(
    client: pg.PoolClient,
    configuration: TenantConfiguration,
  ): Promise<void> {
    const tenantId = configuration.tenantId;
    for (const table of [
      'tenant_provider_bindings',
      'tenant_credential_bindings',
      'tenant_budget_envelopes',
      'tenant_policy_bindings',
      'tenant_approval_chain_bindings',
      'tenant_rbac_grants',
      'tenant_asset_registry_bindings',
      'tenant_analytics_namespaces',
      'tenant_quotas',
      'tenant_campaign_scopes',
    ]) {
      await client.query(`delete from ${table} where tenant_id = $1`, [tenantId]);
    }

    for (const credential of configuration.credentials) {
      await client.query(
        `insert into tenant_credential_bindings (
           tenant_id, credential_binding_id, provider_id, secret_provider,
           secret_key_reference, enabled, allowed_capability_ids, evidence
         ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
        [
          tenantId,
          credential.credentialBindingId,
          credential.providerId,
          credential.secretReference.provider,
          credential.secretReference.key,
          credential.enabled,
          nullableJson(credential.allowedCapabilityIds),
          JSON.stringify(credential.evidence),
        ],
      );
    }

    for (const provider of configuration.providers) {
      await client.query(
        `insert into tenant_provider_bindings (
           tenant_id, provider_id, connected_account_id, credential_binding_id,
           enabled, allowed_capability_ids, evidence
         ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [
          tenantId,
          provider.providerId,
          provider.connectedAccountId,
          provider.credentialBindingId,
          provider.enabled,
          nullableJson(provider.allowedCapabilityIds),
          JSON.stringify(provider.evidence),
        ],
      );
    }

    for (const campaign of configuration.campaigns) {
      await client.query(
        `insert into tenant_campaign_scopes (
           tenant_id, provider_id, connected_account_id, campaign_id, evidence
         ) values ($1, $2, $3, $4, $5::jsonb)`,
        [
          tenantId,
          campaign.providerId,
          campaign.connectedAccountId,
          campaign.campaignId,
          JSON.stringify(campaign.evidence),
        ],
      );
    }

    for (const budget of configuration.budgets) {
      await client.query(
        `insert into tenant_budget_envelopes (
           tenant_id, budget_id, currency, max_single_operation_minor,
           allowed_capability_ids, evidence
         ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
        [
          tenantId,
          budget.budgetId,
          budget.currency,
          budget.maxSingleOperationMinor,
          nullableJson(budget.allowedCapabilityIds),
          JSON.stringify(budget.evidence),
        ],
      );
    }

    for (const policy of configuration.policies) {
      await client.query(
        `insert into tenant_policy_bindings (
           tenant_id, policy_id, policy_resource_id, allowed_risk_classes, evidence
         ) values ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [
          tenantId,
          policy.policyId,
          policy.policyResourceId,
          nullableJson(policy.allowedRiskClasses),
          JSON.stringify(policy.evidence),
        ],
      );
    }

    for (const approval of configuration.approvalChains) {
      await client.query(
        `insert into tenant_approval_chain_bindings (
           tenant_id, approval_chain_id, approval_resource_id,
           route_ids, capability_ids, evidence
         ) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)`,
        [
          tenantId,
          approval.approvalChainId,
          approval.approvalResourceId,
          nullableJson(approval.routeIds),
          nullableJson(approval.capabilityIds),
          JSON.stringify(approval.evidence),
        ],
      );
    }

    for (const grant of configuration.rbacGrants) {
      await client.query(
        `insert into tenant_rbac_grants (
           tenant_id, grant_id, principal_id, role, allowed_route_ids,
           allowed_capability_ids, allowed_target_accounts, enabled, evidence
         ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb)`,
        [
          tenantId,
          grant.grantId,
          grant.principalId,
          grant.role,
          nullableJson(grant.allowedRouteIds),
          nullableJson(grant.allowedCapabilityIds),
          nullableJson(grant.allowedTargetAccounts),
          grant.enabled,
          JSON.stringify(grant.evidence),
        ],
      );
    }

    await client.query(
      `insert into tenant_asset_registry_bindings (
         tenant_id, asset_registry_resource_id, evidence
       ) values ($1, $2, $3::jsonb)`,
      [
        tenantId,
        configuration.assets.assetRegistryResourceId,
        JSON.stringify(configuration.assets.evidence),
      ],
    );
    await client.query(
      `insert into tenant_analytics_namespaces (
         tenant_id, analytics_namespace, evidence
       ) values ($1, $2, $3::jsonb)`,
      [
        tenantId,
        configuration.analytics.analyticsNamespace,
        JSON.stringify(configuration.analytics.evidence),
      ],
    );

    for (const quota of configuration.quotas) {
      await client.query(
        `insert into tenant_quotas (
           tenant_id, quota_id, capability_id, quota_limit, quota_interval, evidence
         ) values ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          tenantId,
          quota.quotaId,
          quota.capabilityId,
          quota.limit,
          quota.interval,
          JSON.stringify(quota.evidence),
        ],
      );
    }
  }

  private async readCredentials(
    client: pg.PoolClient,
    tenantId: string,
  ): Promise<readonly TenantCredentialBinding[]> {
    const result = await client.query(
      `select credential_binding_id, provider_id, secret_provider, secret_key_reference,
              enabled, allowed_capability_ids, evidence
       from tenant_credential_bindings where tenant_id = $1
       order by credential_binding_id`,
      [tenantId],
    );
    return result.rows.map((raw) => {
      const row = raw as CredentialRow;
      return {
        credentialBindingId: row.credential_binding_id,
        providerId: row.provider_id,
        secretReference: { provider: row.secret_provider, key: row.secret_key_reference },
        enabled: row.enabled,
        allowedCapabilityIds: nullableStringArray(
          row.allowed_capability_ids,
          'TENANT_CREDENTIAL_CAPABILITIES_INVALID',
        ),
        evidence: stringArray(row.evidence, 'TENANT_CREDENTIAL_EVIDENCE_INVALID'),
      };
    });
  }

  private async readProviders(
    client: pg.PoolClient,
    tenantId: string,
  ): Promise<readonly TenantProviderBinding[]> {
    const result = await client.query(
      `select provider_id, connected_account_id, credential_binding_id, enabled,
              allowed_capability_ids, evidence
       from tenant_provider_bindings where tenant_id = $1
       order by provider_id, connected_account_id`,
      [tenantId],
    );
    return result.rows.map((raw) => {
      const row = raw as ProviderRow;
      return {
        providerId: row.provider_id,
        connectedAccountId: row.connected_account_id,
        credentialBindingId: row.credential_binding_id,
        enabled: row.enabled,
        allowedCapabilityIds: nullableStringArray(
          row.allowed_capability_ids,
          'TENANT_PROVIDER_CAPABILITIES_INVALID',
        ),
        evidence: stringArray(row.evidence, 'TENANT_PROVIDER_EVIDENCE_INVALID'),
      };
    });
  }

  private async readCampaigns(
    client: pg.PoolClient,
    tenantId: string,
  ): Promise<readonly TenantCampaignBinding[]> {
    const result = await client.query(
      `select provider_id, connected_account_id, campaign_id, evidence
       from tenant_campaign_scopes where tenant_id = $1
       order by provider_id, connected_account_id, campaign_id`,
      [tenantId],
    );
    return result.rows.map((raw) => {
      const row = raw as CampaignRow;
      return {
        providerId: row.provider_id,
        connectedAccountId: row.connected_account_id,
        campaignId: row.campaign_id,
        evidence: stringArray(row.evidence, 'TENANT_CAMPAIGN_EVIDENCE_INVALID'),
      };
    });
  }

  private async readBudgets(
    client: pg.PoolClient,
    tenantId: string,
  ): Promise<readonly TenantBudgetEnvelope[]> {
    const result = await client.query(
      `select budget_id, currency, max_single_operation_minor, allowed_capability_ids, evidence
       from tenant_budget_envelopes where tenant_id = $1 order by budget_id`,
      [tenantId],
    );
    return result.rows.map((raw) => {
      const row = raw as BudgetRow;
      return {
        budgetId: row.budget_id,
        currency: row.currency,
        maxSingleOperationMinor: safeInteger(
          row.max_single_operation_minor,
          'TENANT_BUDGET_LIMIT_INVALID',
        ),
        allowedCapabilityIds: nullableStringArray(
          row.allowed_capability_ids,
          'TENANT_BUDGET_CAPABILITIES_INVALID',
        ),
        evidence: stringArray(row.evidence, 'TENANT_BUDGET_EVIDENCE_INVALID'),
      };
    });
  }

  private async readPolicies(
    client: pg.PoolClient,
    tenantId: string,
  ): Promise<readonly TenantPolicyBinding[]> {
    const result = await client.query(
      `select policy_id, policy_resource_id, allowed_risk_classes, evidence
       from tenant_policy_bindings where tenant_id = $1 order by policy_id`,
      [tenantId],
    );
    return result.rows.map((raw) => {
      const row = raw as PolicyRow;
      return {
        policyId: row.policy_id,
        policyResourceId: row.policy_resource_id,
        allowedRiskClasses: nullableRiskClasses(row.allowed_risk_classes),
        evidence: stringArray(row.evidence, 'TENANT_POLICY_EVIDENCE_INVALID'),
      };
    });
  }

  private async readApprovalChains(
    client: pg.PoolClient,
    tenantId: string,
  ): Promise<readonly TenantApprovalChainBinding[]> {
    const result = await client.query(
      `select approval_chain_id, approval_resource_id, route_ids, capability_ids, evidence
       from tenant_approval_chain_bindings where tenant_id = $1 order by approval_chain_id`,
      [tenantId],
    );
    return result.rows.map((raw) => {
      const row = raw as ApprovalRow;
      return {
        approvalChainId: row.approval_chain_id,
        approvalResourceId: row.approval_resource_id,
        routeIds: nullableRouteIds(row.route_ids),
        capabilityIds: nullableStringArray(
          row.capability_ids,
          'TENANT_APPROVAL_CAPABILITIES_INVALID',
        ),
        evidence: stringArray(row.evidence, 'TENANT_APPROVAL_EVIDENCE_INVALID'),
      };
    });
  }

  private async readRbacGrants(
    client: pg.PoolClient,
    tenantId: string,
  ): Promise<readonly TenantRbacGrant[]> {
    const result = await client.query(
      `select grant_id, principal_id, role, allowed_route_ids, allowed_capability_ids,
              allowed_target_accounts, enabled, evidence
       from tenant_rbac_grants where tenant_id = $1 order by grant_id`,
      [tenantId],
    );
    return result.rows.map((raw) => {
      const row = raw as RbacRow;
      return {
        grantId: row.grant_id,
        principalId: row.principal_id,
        role: authorizationRole(row.role),
        allowedRouteIds: nullableRouteIds(row.allowed_route_ids),
        allowedCapabilityIds: nullableStringArray(
          row.allowed_capability_ids,
          'TENANT_RBAC_CAPABILITIES_INVALID',
        ),
        allowedTargetAccounts: nullableStringArray(
          row.allowed_target_accounts,
          'TENANT_RBAC_ACCOUNTS_INVALID',
        ),
        enabled: row.enabled,
        evidence: stringArray(row.evidence, 'TENANT_RBAC_EVIDENCE_INVALID'),
      };
    });
  }

  private async readAssetBinding(
    client: pg.PoolClient,
    tenantId: string,
    root: TenantRootRow,
  ): Promise<TenantConfiguration['assets']> {
    const result = await client.query(
      `select asset_registry_resource_id, evidence
       from tenant_asset_registry_bindings where tenant_id = $1
       order by asset_registry_resource_id limit 1`,
      [tenantId],
    );
    const row = result.rows[0] as AssetRow | undefined;
    return {
      assetRegistryResourceId: row?.asset_registry_resource_id ?? root.asset_registry_resource_id,
      evidence: row
        ? stringArray(row.evidence, 'TENANT_ASSET_EVIDENCE_INVALID')
        : stringArray(root.evidence, 'TENANT_CONFIGURATION_EVIDENCE_INVALID'),
    };
  }

  private async readAnalyticsBinding(
    client: pg.PoolClient,
    tenantId: string,
    root: TenantRootRow,
  ): Promise<TenantConfiguration['analytics']> {
    const result = await client.query(
      `select analytics_namespace, evidence
       from tenant_analytics_namespaces where tenant_id = $1
       order by analytics_namespace limit 1`,
      [tenantId],
    );
    const row = result.rows[0] as AnalyticsRow | undefined;
    return {
      analyticsNamespace: row?.analytics_namespace ?? root.analytics_namespace,
      evidence: row
        ? stringArray(row.evidence, 'TENANT_ANALYTICS_EVIDENCE_INVALID')
        : stringArray(root.evidence, 'TENANT_CONFIGURATION_EVIDENCE_INVALID'),
    };
  }

  private async readQuotas(
    client: pg.PoolClient,
    tenantId: string,
  ): Promise<readonly TenantQuota[]> {
    const result = await client.query(
      `select quota_id, capability_id, quota_limit, quota_interval, evidence
       from tenant_quotas where tenant_id = $1 order by quota_id`,
      [tenantId],
    );
    return result.rows.map((raw) => {
      const row = raw as QuotaRow;
      if (!['HOUR', 'DAY', 'MONTH'].includes(row.quota_interval)) {
        throw new TenantIsolationError('TENANT_QUOTA_INTERVAL_INVALID');
      }
      return {
        quotaId: row.quota_id,
        capabilityId: row.capability_id,
        limit: safeInteger(row.quota_limit, 'TENANT_QUOTA_LIMIT_INVALID'),
        interval: row.quota_interval as TenantQuota['interval'],
        evidence: stringArray(row.evidence, 'TENANT_QUOTA_EVIDENCE_INVALID'),
      };
    });
  }
}

function tenantStatus(value: string): TenantStatus {
  if ((TENANT_STATUSES as readonly string[]).includes(value)) return value as TenantStatus;
  throw new TenantIsolationError('TENANT_STATUS_INVALID');
}

function authorizationRole(value: string): AuthorizationRole {
  if ((AUTHORIZATION_ROLES as readonly string[]).includes(value)) return value as AuthorizationRole;
  throw new TenantIsolationError('TENANT_RBAC_ROLE_INVALID');
}

function nullableRiskClasses(value: unknown): readonly RiskClass[] | null {
  if (value === null) return null;
  const values = stringArray(value, 'TENANT_POLICY_RISK_CLASSES_INVALID');
  if (values.some((entry) => !(RISK_CLASSES as readonly string[]).includes(entry))) {
    throw new TenantIsolationError('TENANT_POLICY_RISK_CLASSES_INVALID');
  }
  return values as readonly RiskClass[];
}

function nullableRouteIds(value: unknown): readonly RouteId[] | null {
  if (value === null) return null;
  const values = stringArray(value, 'TENANT_ROUTE_IDS_INVALID');
  if (values.some((entry) => !isRouteId(entry))) {
    throw new TenantIsolationError('TENANT_ROUTE_IDS_INVALID');
  }
  return values as readonly RouteId[];
}

function nullableStringArray(value: unknown, code: string): readonly string[] | null {
  if (value === null) return null;
  return stringArray(value, code);
}

function stringArray(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new TenantIsolationError(code);
  }
  return value;
}

function safeInteger(value: string | number, code: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TenantIsolationError(code);
  return parsed;
}

function nullableJson(value: readonly string[] | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
