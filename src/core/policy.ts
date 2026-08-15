import type { RiskClass, ToolDefinition } from './tool-registry.js';
import { authorizeExecution, type ExecutionIdentity } from './identity.js';
import {
  verifyApproval,
  type ApprovalExpectation,
  type ApprovalRecord,
} from '../governance/approval-governance.js';
import { getCapabilityDefinition } from '../governance/capability-catalog.js';

export type PolicyDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

export interface PolicyContext {
  readonly identity?: ExecutionIdentity | undefined;
  /** @deprecated Use identity.principal.principalId. Kept only for non-mutating compatibility paths. */
  readonly requester?: string;
  readonly connectedAccount?: string;
  readonly approval?: ApprovalRecord;
  readonly descriptorSha256?: string;
  readonly requiredApprovalScope?: readonly string[];
  readonly financialAmountMinor?: number;
  readonly currency?: string;
  readonly now?: string;
  /** @deprecated A boolean never authorizes a side effect. Supply a verified ApprovalRecord. */
  readonly approved?: boolean;
}

export interface PolicyResult {
  readonly decision: PolicyDecision;
  readonly reason: string;
}

const approvalRiskClasses: ReadonlySet<RiskClass> = new Set([
  'WRITE_EXTERNAL',
  'FINANCIAL_IMPACT',
  'DESTRUCTIVE',
]);

export function requiresFormalApproval(tool: ToolDefinition): boolean {
  return approvalRiskClasses.has(tool.riskClass);
}

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
  if (
    tool.capabilityStatus === 'SUSPENDED' ||
    tool.capabilityStatus === 'REMOVED' ||
    tool.capabilityStatus === 'DISABLED' ||
    tool.capabilityStatus === 'RETIRED' ||
    tool.capabilityStatus === 'BLOCKED'
  ) {
    return {
      decision: 'DENY',
      reason: `Capability is ${tool.capabilityStatus}.`,
    };
  }

  if (tool.capabilityStatus !== 'PRODUCTION_VALIDATED' && tool.sideEffects) {
    return {
      decision: 'DENY',
      reason: 'Write capability is not production validated.',
    };
  }

  const capability = getCapabilityDefinition(tool.name);
  if (tool.sideEffects) {
    const routeId = capability?.primary_route_id ?? capability?.route_id;
    const authorization = authorizeExecution(context.identity, {
      capabilityId: tool.name,
      riskClass: tool.riskClass,
      ...(routeId && routeId !== 'TRANSVERSAL' ? { routeId } : {}),
      ...(context.connectedAccount ? { targetAccount: context.connectedAccount } : {}),
      ...(context.now ? { now: context.now } : {}),
    });
    if (!authorization.allowed) {
      return {
        decision: 'DENY',
        reason: authorization.reason,
      };
    }
  }

  if (requiresFormalApproval(tool)) {
    const expectation = approvalExpectationFromPolicy(tool, context);
    if (!context.approval || !expectation) {
      return {
        decision: 'REQUIRE_APPROVAL',
        reason: `Risk class ${tool.riskClass} requires a formal ApprovalRecord bound to the authenticated principal.`,
      };
    }

    const verification = verifyApproval(context.approval, expectation, context.now);
    if (!verification.valid) {
      return {
        decision: 'REQUIRE_APPROVAL',
        reason: `ApprovalRecord failed validation: ${verification.reasons.join(',')}.`,
      };
    }
  }

  return { decision: 'ALLOW', reason: 'Policy requirements satisfied.' };
}
