import { authorizeExecution, type ExecutionIdentity } from '../core/identity.js';
import type {
  TenantBoundaryExpectation,
  TenantCapabilityAvailability,
  TenantConfiguration,
  TenantConfigurationStore,
  TenantScope,
  TenantScopedResource,
} from './contracts.js';
import {
  assertSameTenantBoundary,
  assertTenantScope,
  TenantIsolationError,
} from './tenant-configuration.js';

export interface TenantAccessDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly evidence: readonly string[];
}

export function authorizeTenantResourceAccess(
  identity: ExecutionIdentity | undefined,
  resource: TenantScopedResource,
  expectation: TenantBoundaryExpectation,
): TenantAccessDecision {
  if (!identity) return deny('IDENTITY_REQUIRED');

  const identityScope: TenantScope = {
    tenantId: identity.principal.tenantId,
    workspaceId: identity.principal.workspaceId,
    organizationId: identity.principal.organizationId,
  };
  try {
    assertSameTenantBoundary(identityScope, resource);
  } catch (error) {
    return deny(error instanceof TenantIsolationError ? error.code : 'TENANT_SCOPE_INVALID');
  }

  const decision = authorizeExecution(identity, expectation);
  if (!decision.allowed) return deny(decision.reason);
  return {
    allowed: true,
    reason: 'TENANT_RESOURCE_AUTHORIZED',
    evidence: [...identity.principal.evidence, ...identity.authorization.evidence],
  };
}

export function assertTenantResourceAccess(
  identity: ExecutionIdentity | undefined,
  resource: TenantScopedResource,
  expectation: TenantBoundaryExpectation,
): void {
  const decision = authorizeTenantResourceAccess(identity, resource, expectation);
  if (!decision.allowed) throw new TenantIsolationError(decision.reason);
}

export class TenantCapabilityAvailabilityResolver {
  constructor(private readonly configurations: TenantConfigurationStore) {}

  async resolve(input: {
    readonly identity: ExecutionIdentity;
    readonly capabilityId: string;
    readonly providerId?: string;
  }): Promise<TenantCapabilityAvailability> {
    const configuration = await this.requireConfiguration(input.identity.principal.tenantId);
    const identityScope: TenantScope = {
      tenantId: input.identity.principal.tenantId,
      workspaceId: input.identity.principal.workspaceId,
      organizationId: input.identity.principal.organizationId,
    };
    try {
      assertSameTenantBoundary(identityScope, configuration);
    } catch (error) {
      return unavailable(error instanceof TenantIsolationError ? error.code : 'TENANT_SCOPE_INVALID');
    }
    if (configuration.status !== 'ACTIVE') return unavailable('TENANT_SUSPENDED');
    if (configuration.deniedCapabilityIds.includes(input.capabilityId)) {
      return unavailable('TENANT_CAPABILITY_DENIED');
    }
    if (
      configuration.allowedCapabilityIds &&
      !configuration.allowedCapabilityIds.includes(input.capabilityId)
    ) {
      return unavailable('TENANT_CAPABILITY_NOT_ALLOWED');
    }
    if (input.providerId) {
      const provider = configuration.providers.find(
        (candidate) => candidate.providerId === input.providerId,
      );
      if (!provider?.enabled) return unavailable('TENANT_PROVIDER_UNAVAILABLE');
      if (
        provider.allowedCapabilityIds &&
        !provider.allowedCapabilityIds.includes(input.capabilityId)
      ) {
        return unavailable('TENANT_PROVIDER_CAPABILITY_NOT_ALLOWED');
      }
    }
    return {
      available: true,
      reason: 'TENANT_CAPABILITY_AVAILABLE',
      evidence: configuration.evidence,
    };
  }

  private async requireConfiguration(tenantId: string): Promise<TenantConfiguration> {
    assertTenantScope({ tenantId, workspaceId: tenantId, organizationId: tenantId });
    const configuration = await this.configurations.get(tenantId);
    if (!configuration) throw new TenantIsolationError('TENANT_CONFIGURATION_NOT_FOUND');
    return configuration;
  }
}

function deny(reason: string): TenantAccessDecision {
  return { allowed: false, reason, evidence: [] };
}

function unavailable(reason: string): TenantCapabilityAvailability {
  return { available: false, reason, evidence: [] };
}
