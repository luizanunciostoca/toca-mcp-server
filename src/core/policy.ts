import type { ApprovalExpectation, ApprovalRecord } from '../governance/approval-governance.js';
import { getCapabilityDefinition } from '../governance/capability-catalog.js';
import {
  evaluateAutonomyGate,
  requiresFormalApproval,
  type AutonomyGateContext,
} from './autonomy-gate.js';
import type { ToolDefinition } from './tool-registry.js';

export type PolicyDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

export interface PolicyContext extends AutonomyGateContext {
  readonly approval?: ApprovalRecord;
}

export interface PolicyResult {
  readonly decision: PolicyDecision;
  readonly reason: string;
}

export { requiresFormalApproval };

export function approvalExpectationFromPolicy(
  tool: ToolDefinition,
  context: PolicyContext,
): ApprovalExpectation | undefined {
  const capability = getCapabilityDefinition(tool.name);
  const routeId = capability?.primary_route_id ?? capability?.route_id;
  const requester = context.identity?.principal.principalId;
  if (
    !requester ||
    !context.descriptorSha256 ||
    !context.connectedAccount ||
    !routeId ||
    routeId === 'TRANSVERSAL'
  ) {
    return undefined;
  }
  return {
    requester,
    routeId,
    capabilityId: tool.name,
    descriptorSha256: context.descriptorSha256,
    targetAccount: context.connectedAccount,
    requiredScope: context.requiredApprovalScope ?? [tool.name],
    ...(context.financialAmountMinor !== undefined
      ? { financialAmountMinor: context.financialAmountMinor }
      : {}),
    ...(context.currency ? { currency: context.currency } : {}),
  };
}

export function evaluatePolicy(tool: ToolDefinition, context: PolicyContext): PolicyResult {
  const result = evaluateAutonomyGate(tool, context, {
    enforceOperationalReadiness: false,
  });
  if (result.reasonCode === 'KILL_SWITCH_GLOBAL') {
    return {
      decision: result.decision,
      reason: 'Platform mutation kill switch is active.',
    };
  }
  if (result.decision === 'ALLOW') {
    return { decision: 'ALLOW', reason: 'Policy requirements satisfied.' };
  }
  return { decision: result.decision, reason: result.reason };
}
