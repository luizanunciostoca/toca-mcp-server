import { authorizeExecution, type ExecutionIdentity } from '../core/identity.js';
import type {
  TenantApprovalChainBinding,
  TenantConfiguration,
  TenantConfigurationStore,
  TenantPolicyDecision,
  TenantPolicyRequest,
  TenantScope,
} from './contracts.js';
import { TenantCapabilityAvailabilityResolver } from './tenant-boundary.js';
import { assertSameTenantBoundary, TenantIsolationError } from './tenant-configuration.js';

export class TenantPolicyOverlay {
  readonly #availability: TenantCapabilityAvailabilityResolver;

  constructor(private readonly configurations: TenantConfigurationStore) {
    this.#availability = new TenantCapabilityAvailabilityResolver(configurations);
  }

  async evaluate(
    identity: ExecutionIdentity,
    request: TenantPolicyRequest,
  ): Promise<TenantPolicyDecision> {
    const configuration = await this.requireConfiguration(identity);
    if (configuration.status !== 'ACTIVE') return deny('TENANT_SUSPENDED');

    const authorization = authorizeExecution(identity, {
      capabilityId: request.capabilityId,
      riskClass: request.riskClass,
      ...(request.routeId ? { routeId: request.routeId } : {}),
      ...(request.targetAccount ? { targetAccount: request.targetAccount } : {}),
    });
    if (!authorization.allowed) return deny(authorization.reason);

    let availability;
    try {
      availability = await this.#availability.resolve({
        identity,
        capabilityId: request.capabilityId,
        ...(request.providerId ? { providerId: request.providerId } : {}),
      });
    } catch (error) {
      return deny(error instanceof TenantIsolationError ? error.code : 'TENANT_CAPABILITY_UNAVAILABLE');
    }
    if (!availability.available) return deny(availability.reason);

    const policyBindings = configuration.policies
      .filter(
        (binding) =>
          binding.allowedRiskClasses === null || binding.allowedRiskClasses.includes(request.riskClass),
      )
      .sort((left, right) => left.policyId.localeCompare(right.policyId));
    if (policyBindings.length === 0) return deny('TENANT_POLICY_NOT_CONFIGURED');

    let budgetId: string | null = null;
    if (request.requestedBudgetMinor !== undefined) {
      if (
        !Number.isSafeInteger(request.requestedBudgetMinor) ||
        request.requestedBudgetMinor < 0 ||
        !request.currency ||
        !/^[A-Z]{3}$/.test(request.currency)
      ) {
        return deny('TENANT_BUDGET_REQUEST_INVALID');
      }
      const budget = configuration.budgets
        .filter(
          (candidate) =>
            candidate.currency === request.currency &&
            (candidate.allowedCapabilityIds === null ||
              candidate.allowedCapabilityIds.includes(request.capabilityId)),
        )
        .sort((left, right) => left.budgetId.localeCompare(right.budgetId))[0];
      if (!budget) return deny('TENANT_BUDGET_NOT_CONFIGURED');
      if (request.requestedBudgetMinor > budget.maxSingleOperationMinor) {
        return deny('TENANT_BUDGET_LIMIT_EXCEEDED');
      }
      budgetId = budget.budgetId;
    }

    const approvalChain = resolveApprovalChain(configuration, request);
    return {
      allowed: true,
      reason: 'TENANT_POLICY_ALLOWED',
      approvalChainId: approvalChain?.approvalChainId ?? null,
      policyResourceIds: policyBindings.map((binding) => binding.policyResourceId),
      budgetId,
      evidence: [
        ...configuration.evidence,
        ...availability.evidence,
        ...policyBindings.flatMap((binding) => binding.evidence),
        ...(approvalChain?.evidence ?? []),
      ],
    };
  }

  private async requireConfiguration(identity: ExecutionIdentity): Promise<TenantConfiguration> {
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

function resolveApprovalChain(
  configuration: TenantConfiguration,
  request: TenantPolicyRequest,
): TenantApprovalChainBinding | undefined {
  return configuration.approvalChains
    .filter(
      (binding) =>
        (binding.capabilityIds === null || binding.capabilityIds.includes(request.capabilityId)) &&
        (binding.routeIds === null ||
          (request.routeId !== undefined && binding.routeIds.includes(request.routeId))),
    )
    .sort((left, right) => left.approvalChainId.localeCompare(right.approvalChainId))[0];
}

function deny(reason: string): TenantPolicyDecision {
  return {
    allowed: false,
    reason,
    approvalChainId: null,
    policyResourceIds: [],
    budgetId: null,
    evidence: [],
  };
}
