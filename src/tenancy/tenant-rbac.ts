import { authorizeExecution, type ExecutionIdentity } from '../core/identity.js';
import type { TenantBoundaryExpectation, TenantConfiguration } from './contracts.js';

export interface TenantRbacDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly evidence: readonly string[];
}

export function authorizeTenantRbac(
  configuration: TenantConfiguration,
  identity: ExecutionIdentity,
  expectation: TenantBoundaryExpectation,
): TenantRbacDecision {
  const coreDecision = authorizeExecution(identity, expectation);
  if (!coreDecision.allowed) return deny(coreDecision.reason);

  if (
    identity.principal.tenantId !== configuration.tenantId ||
    identity.authorization.tenantId !== configuration.tenantId
  ) {
    return deny('TENANT_SCOPE_MISMATCH');
  }

  const grants = configuration.rbacGrants
    .filter(
      (grant) =>
        grant.enabled &&
        grant.principalId === identity.principal.principalId &&
        identity.authorization.roles.includes(grant.role),
    )
    .sort((left, right) => left.grantId.localeCompare(right.grantId));

  if (grants.length === 0) return deny('TENANT_RBAC_GRANT_REQUIRED');

  for (const grant of grants) {
    const scopedIdentity: ExecutionIdentity = {
      principal: identity.principal,
      authorization: {
        principalId: identity.authorization.principalId,
        tenantId: identity.authorization.tenantId,
        roles: [grant.role],
        allowedRouteIds: grant.allowedRouteIds,
        allowedCapabilityIds: grant.allowedCapabilityIds,
        allowedTargetAccounts: grant.allowedTargetAccounts,
        evidence: [...identity.authorization.evidence, ...grant.evidence],
      },
    };
    const decision = authorizeExecution(scopedIdentity, expectation);
    if (decision.allowed) {
      return {
        allowed: true,
        reason: 'TENANT_RBAC_ALLOWED',
        evidence: [...configuration.evidence, ...grant.evidence],
      };
    }
  }

  return deny('TENANT_RBAC_NOT_ALLOWED');
}

function deny(reason: string): TenantRbacDecision {
  return { allowed: false, reason, evidence: [] };
}
