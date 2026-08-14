import type { RiskClass, ToolDefinition } from './tool-registry.js';
import { verifyApproval, type ApprovalRecord } from '../governance/approval-governance.js';
import { getCapabilityDefinition } from '../governance/capability-catalog.js';

export type PolicyDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

export interface PolicyContext {
  readonly requester: string;
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

export function evaluatePolicy(tool: ToolDefinition, context: PolicyContext): PolicyResult {
  if (tool.capabilityStatus === 'SUSPENDED' || tool.capabilityStatus === 'REMOVED') {
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

  if (approvalRiskClasses.has(tool.riskClass)) {
    const routeId = getCapabilityDefinition(tool.name)?.route_id;
    if (
      !context.approval ||
      !context.descriptorSha256 ||
      !context.connectedAccount ||
      !routeId ||
      routeId === 'TRANSVERSAL'
    ) {
      return {
        decision: 'REQUIRE_APPROVAL',
        reason: `Risk class ${tool.riskClass} requires a formal ApprovalRecord.`,
      };
    }

    const verification = verifyApproval(
      context.approval,
      {
        requester: context.requester,
        routeId,
        capabilityId: tool.name,
        descriptorSha256: context.descriptorSha256,
        targetAccount: context.connectedAccount,
        requiredScope: context.requiredApprovalScope ?? [tool.name],
        ...(context.financialAmountMinor !== undefined
          ? { financialAmountMinor: context.financialAmountMinor }
          : {}),
        ...(context.currency ? { currency: context.currency } : {}),
      },
      context.now,
    );
    if (!verification.valid) {
      return {
        decision: 'REQUIRE_APPROVAL',
        reason: `ApprovalRecord failed validation: ${verification.reasons.join(',')}.`,
      };
    }
  }

  return { decision: 'ALLOW', reason: 'Policy requirements satisfied.' };
}
