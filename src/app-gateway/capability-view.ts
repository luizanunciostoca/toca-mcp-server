import { requiresFormalApproval } from '../core/policy.js';
import type { CapabilityStatus, ToolDefinition, ToolRegistry } from '../core/tool-registry.js';
import type { ActionAvailability, CapabilitySnapshot } from './contracts.js';

export function capabilityStatusToAvailability(status: CapabilityStatus): ActionAvailability {
  switch (status) {
    case 'PRODUCTION_VALIDATED':
      return 'AVAILABLE';
    case 'INTEGRATION_VALIDATED':
    case 'CONNECTED':
    case 'DEGRADED':
      return 'LIMITED';
    case 'PLANNED':
    case 'SPECIFIED':
    case 'IMPLEMENTED':
      return 'UNAVAILABLE';
    case 'DISABLED':
    case 'BLOCKED':
    case 'SUSPENDED':
    case 'DEPRECATED':
    case 'RETIRED':
    case 'REMOVED':
      return 'BLOCKED';
  }
}

export function capabilitySnapshotFromTool(tool: ToolDefinition): CapabilitySnapshot {
  const availability = capabilityStatusToAvailability(tool.capabilityStatus);
  return {
    capabilityId: tool.name,
    lifecycleStatus: tool.capabilityStatus,
    availability,
    provider: tool.provider,
    riskClass: tool.riskClass,
    sideEffects: tool.sideEffects,
    approvalHint: requiresFormalApproval(tool),
    reason: lifecycleReason(tool.capabilityStatus, availability),
  };
}

export function resolveCapabilitySnapshot(
  registry: ToolRegistry,
  capabilityId: string,
): CapabilitySnapshot {
  const tool = registry.get(capabilityId);
  if (!tool) {
    return {
      capabilityId,
      lifecycleStatus: 'NOT_REGISTERED',
      availability: 'UNAVAILABLE',
      provider: null,
      riskClass: null,
      sideEffects: false,
      approvalHint: false,
      reason: 'Capability is not registered in the running server.',
    };
  }
  return capabilitySnapshotFromTool(tool);
}

function lifecycleReason(status: CapabilityStatus, availability: ActionAvailability): string {
  switch (availability) {
    case 'AVAILABLE':
      return `Capability is ${status} and may be offered by the client, subject to runtime policy.`;
    case 'LIMITED':
      return `Capability is ${status}; the client must present it as limited and revalidate before execution.`;
    case 'UNAVAILABLE':
      return `Capability is ${status}; implementation/catalog presence does not make it executable.`;
    case 'BLOCKED':
      return `Capability is ${status}; new execution must remain blocked.`;
  }
}
