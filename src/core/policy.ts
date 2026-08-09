import type { RiskClass, ToolDefinition } from './tool-registry.js';

export type PolicyDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

export interface PolicyContext {
  readonly requester: string;
  readonly connectedAccount?: string;
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
    return { decision: 'DENY', reason: `Capability is ${tool.capabilityStatus}.` };
  }

  if (tool.capabilityStatus !== 'PRODUCTION_VALIDATED' && tool.sideEffects) {
    return { decision: 'DENY', reason: 'Write capability is not production validated.' };
  }

  if (approvalRiskClasses.has(tool.riskClass) && !context.approved) {
    return { decision: 'REQUIRE_APPROVAL', reason: `Risk class ${tool.riskClass} requires approval.` };
  }

  return { decision: 'ALLOW', reason: 'Policy requirements satisfied.' };
}
