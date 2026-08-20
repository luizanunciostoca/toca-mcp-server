import type { AuthorizationRole } from '../core/identity.js';
import type { SecretReference } from '../core/secrets.js';
import type { RiskClass } from '../core/tool-registry.js';
import type { RouteId } from '../governance/types.js';

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export interface TenantScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

export interface TenantScopedResource extends TenantScope {
  readonly resourceId: string;
}

export interface TenantProviderBinding {
  readonly providerId: string;
  readonly connectedAccountId: string;
  readonly credentialBindingId: string;
  readonly enabled: boolean;
  readonly allowedCapabilityIds: readonly string[] | null;
  readonly evidence: readonly string[];
}

export interface TenantCredentialBinding {
  readonly credentialBindingId: string;
  readonly providerId: string;
  readonly secretReference: SecretReference;
  readonly allowedCapabilityIds: readonly string[] | null;
  readonly enabled: boolean;
  readonly evidence: readonly string[];
}

export interface TenantCampaignBinding {
  readonly providerId: string;
  readonly connectedAccountId: string;
  readonly campaignId: string;
  readonly evidence: readonly string[];
}

export interface TenantBrandCreativeTruthBinding {
  readonly brandResourceId: string;
  readonly creativeTruthRegistryResourceId: string;
  readonly evidence: readonly string[];
}

export interface TenantBudgetEnvelope {
  readonly budgetId: string;
  readonly currency: string;
  readonly maxSingleOperationMinor: number;
  readonly allowedCapabilityIds: readonly string[] | null;
  readonly evidence: readonly string[];
}

export interface TenantPolicyBinding {
  readonly policyId: string;
  readonly policyResourceId: string;
  readonly allowedRiskClasses: readonly RiskClass[] | null;
  readonly evidence: readonly string[];
}

export interface TenantApprovalChainBinding {
  readonly approvalChainId: string;
  readonly approvalResourceId: string;
  readonly routeIds: readonly RouteId[] | null;
  readonly capabilityIds: readonly string[] | null;
  readonly evidence: readonly string[];
}

export interface TenantRbacGrant {
  readonly grantId: string;
  readonly principalId: string;
  readonly role: AuthorizationRole;
  readonly allowedRouteIds: readonly RouteId[] | null;
  readonly allowedCapabilityIds: readonly string[] | null;
  readonly allowedTargetAccounts: readonly string[] | null;
  readonly enabled: boolean;
  readonly evidence: readonly string[];
}

export interface TenantAssetRegistryBinding {
  readonly assetRegistryResourceId: string;
  readonly evidence: readonly string[];
}

export interface TenantAnalyticsBinding {
  readonly analyticsNamespace: string;
  readonly evidence: readonly string[];
}

export interface TenantQuota {
  readonly quotaId: string;
  readonly capabilityId: string;
  readonly limit: number;
  readonly interval: 'HOUR' | 'DAY' | 'MONTH';
  readonly evidence: readonly string[];
}

export interface TenantConfiguration extends TenantScope {
  readonly status: TenantStatus;
  readonly displayName: string;
  readonly allowedCapabilityIds: readonly string[] | null;
  readonly deniedCapabilityIds: readonly string[];
  readonly providers: readonly TenantProviderBinding[];
  readonly credentials: readonly TenantCredentialBinding[];
  readonly campaigns: readonly TenantCampaignBinding[];
  readonly brandCreativeTruth: TenantBrandCreativeTruthBinding;
  readonly budgets: readonly TenantBudgetEnvelope[];
  readonly policies: readonly TenantPolicyBinding[];
  readonly approvalChains: readonly TenantApprovalChainBinding[];
  readonly rbacGrants: readonly TenantRbacGrant[];
  readonly assets: TenantAssetRegistryBinding;
  readonly analytics: TenantAnalyticsBinding;
  readonly quotas: readonly TenantQuota[];
  readonly version: number;
  readonly evidence: readonly string[];
}

export interface TenantConfigurationStore {
  get(tenantId: string): Promise<TenantConfiguration | undefined>;
  put(configuration: TenantConfiguration): Promise<void>;
}

export interface TenantCapabilityAvailability {
  readonly available: boolean;
  readonly reason: string;
  readonly evidence: readonly string[];
}

export interface TenantBoundaryExpectation {
  readonly capabilityId: string;
  readonly riskClass: RiskClass;
  readonly routeId?: RouteId;
  readonly targetAccount?: string;
}

export interface TenantPolicyRequest extends TenantBoundaryExpectation {
  readonly providerId?: string;
  readonly requestedBudgetMinor?: number;
  readonly currency?: string;
}

export interface TenantPolicyDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly approvalChainId: string | null;
  readonly policyResourceIds: readonly string[];
  readonly budgetId: string | null;
  readonly evidence: readonly string[];
}
