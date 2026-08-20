import { requiresFormalApproval } from '../core/policy.js';
import { resolveCapabilityDefinition } from '../governance/capability-resolution.js';
import {
  executeCoreCapability,
  requestCoreApproval,
  resolveCoreRuntimeExecution,
  type CoreExecutionDependencies,
} from '../mcp/core-execution.js';
import type { CoreCapabilityGateway } from './contracts.js';

export class ExistingCoreCapabilityGateway implements CoreCapabilityGateway {
  constructor(private readonly dependencies: CoreExecutionDependencies) {}

  inspect(input: Parameters<CoreCapabilityGateway['inspect']>[0]) {
    const resolved = resolveCoreRuntimeExecution(
      input.capabilityId,
      input.payload,
      input.identity,
      this.dependencies,
    );
    const definition = resolveCapabilityDefinition(resolved.capabilityId)?.canonical_definition;
    const routeId = definition?.primary_route_id ?? definition?.route_id;
    return {
      canonicalCapabilityId: resolved.capabilityId,
      routeId: routeId && routeId !== 'TRANSVERSAL' ? routeId : null,
      sideEffects: resolved.tool.sideEffects,
      approvalRequired: requiresFormalApproval(resolved.tool),
      idempotent: resolved.tool.idempotent,
    };
  }

  async execute(input: Parameters<CoreCapabilityGateway['execute']>[0]) {
    const result = await executeCoreCapability(
      {
        capabilityId: input.capabilityId,
        payload: input.payload,
        correlationId: input.correlationId,
        ...(input.approvalId ? { approvalId: input.approvalId } : {}),
      },
      input.identity,
      this.dependencies,
    );
    return {
      executionId: result.executionId,
      capabilityId: result.capabilityId,
      result: result.result,
      providerReadbackVerified: result.providerReadbackVerified,
    };
  }

  requestApproval(input: Parameters<CoreCapabilityGateway['requestApproval']>[0]) {
    return requestCoreApproval(
      {
        capabilityId: input.capabilityId,
        payload: input.payload,
        correlationId: input.correlationId,
        expiresAt: input.expiresAt,
        evidence: input.evidence,
      },
      input.identity,
      this.dependencies,
    );
  }

  getApproval(approvalId: string) {
    if (!this.dependencies.approvalStore) return Promise.resolve(undefined);
    return this.dependencies.approvalStore.get(approvalId);
  }
}
