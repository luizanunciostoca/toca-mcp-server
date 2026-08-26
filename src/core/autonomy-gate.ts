import {
  verifyApproval,
  type ApprovalExpectation,
  type ApprovalRecord,
} from '../governance/approval-governance.js';
import {
  loadEffectiveAutonomyPolicy,
  type AutonomyAuthorityLevel,
  type AutonomyMode,
  type CompiledAutonomyPolicy,
} from '../governance/autonomy-policy.js';
import { getCapabilityDefinition } from '../governance/capability-catalog.js';
import type { AutopilotReadinessResult } from '../health/autopilot-readiness.js';
import { authorizeExecution, type ExecutionIdentity } from './identity.js';
import type { ToolDefinition } from './tool-registry.js';

export type AutonomyGateDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

export interface ProviderHealthEvidence {
  readonly provider: string;
  readonly tenantId: string;
  readonly status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';
  readonly circuit: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  readonly evidence: readonly string[];
  readonly checkedAt: string;
}

export interface AutonomyGateContext {
  readonly identity?: ExecutionIdentity;
  readonly requester?: string;
  readonly connectedAccount?: string;
  readonly approval?: ApprovalRecord;
  readonly descriptorSha256?: string;
  readonly idempotencyKey?: string;
  readonly requiredApprovalScope?: readonly string[];
  readonly financialAmountMinor?: number;
  readonly currency?: string;
  readonly now?: string;
  readonly policyVersion?: string;
  readonly autonomyMode?: AutonomyMode;
  readonly preapprovedClassId?: string;
  readonly readiness?: AutopilotReadinessResult;
  readonly providerHealth?: ProviderHealthEvidence;
  readonly platformKillSwitch?: boolean;
  readonly tenantKillSwitch?: boolean;
  readonly providerKillSwitches?: readonly string[];
  readonly capabilityKillSwitches?: readonly string[];
  readonly approved?: boolean;
}

export interface AutonomyGateResult {
  readonly decision: AutonomyGateDecision;
  readonly reasonCode: string;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly authority: AutonomyAuthorityLevel | 'NONE';
  readonly mode: AutonomyMode;
  readonly policyVersion: string;
  readonly shadowOnly: boolean;
}

export interface AutonomyGateOptions {
  readonly policy?: CompiledAutonomyPolicy;
  readonly enforceOperationalReadiness?: boolean;
}

const approvalRiskClasses: ReadonlySet<ToolDefinition['riskClass']> = new Set([
  'WRITE_EXTERNAL',
  'FINANCIAL_IMPACT',
  'DESTRUCTIVE',
]);

export function evaluateAutonomyGate(
  tool: ToolDefinition,
  context: AutonomyGateContext,
  options: AutonomyGateOptions = {},
): AutonomyGateResult {
  const compiled = options.policy ?? loadEffectiveAutonomyPolicy();
  const policy = compiled.policy;
  const mode = context.autonomyMode ?? policy.modes.default;
  const enforceOperationalReadiness = options.enforceOperationalReadiness ?? true;
  const tenantId = context.identity?.principal.tenantId ?? 'UNKNOWN';
  const now = context.now ?? new Date().toISOString();
  const capability = getCapabilityDefinition(tool.name);
  const operation = normalizeOperation(tool.name, capability?.operation);
  const rule = compiled.resolve({
    capabilityId: tool.name,
    operation,
    provider: tool.provider,
    tenantId,
    riskClass: tool.riskClass,
    sideEffect: tool.sideEffects,
  });
  const authority =
    rule?.authority ??
    (tool.sideEffects
      ? policy.defaults.sideEffectAuthority
      : policy.defaults.nonSideEffectAuthority);
  const baseEvidence = normalizeEvidence([
    `policy:${policy.policyId}:${policy.policyVersion}`,
    `mode:${mode}`,
    `capability:${tool.name}:${tool.capabilityStatus}`,
    ...(rule ? [`autonomy-rule:${rule.ruleId}`] : []),
  ]);

  if (mode === 'OFF') {
    return deny('AUTOPILOT_MODE_OFF', 'Autopilot mode OFF blocks autonomous execution.', authority);
  }

  if (tool.sideEffects) {
    const killSwitch = activeKillSwitch(tool, context, tenantId);
    if (killSwitch) {
      return deny(killSwitch, 'A scoped mutation kill switch is active.', authority);
    }
  }

  if (isUnavailableStatus(tool.capabilityStatus)) {
    return deny(
      `CAPABILITY_${tool.capabilityStatus}`,
      `Capability is ${tool.capabilityStatus}.`,
      authority,
    );
  }
  if (tool.sideEffects && tool.capabilityStatus !== 'PRODUCTION_VALIDATED') {
    return deny(
      'CAPABILITY_NOT_PRODUCTION_VALIDATED',
      'Write capability is not production validated.',
      authority,
    );
  }

  if (tool.sideEffects && !rule && enforceOperationalReadiness) {
    return deny(
      'AUTONOMY_RULE_MISSING',
      'No effective-autonomy rule authorizes this side effect.',
      authority,
    );
  }
  if (rule && !rule.allowedModes.includes(mode)) {
    return deny(
      'AUTONOMY_MODE_NOT_ALLOWED',
      `Autonomy mode ${mode} is not allowed by rule ${rule.ruleId}.`,
      authority,
    );
  }

  if (!tool.sideEffects) {
    return allow(
      mode === 'OBSERVE' ? 'AUTONOMY_SHADOW_ALLOWED' : 'AUTO_INTERNAL_ALLOWED',
      mode === 'OBSERVE'
        ? 'Internal reasoning is allowed only as a shadow decision.'
        : 'Internal policy requirements satisfied.',
      authority,
      baseEvidence,
      mode === 'OBSERVE',
      mode,
      policy.policyVersion,
    );
  }

  const routeId = capability?.primary_route_id ?? capability?.route_id;
  const authorization = authorizeExecution(context.identity, {
    capabilityId: tool.name,
    riskClass: tool.riskClass,
    ...(routeId && routeId !== 'TRANSVERSAL' ? { routeId } : {}),
    ...(context.connectedAccount ? { targetAccount: context.connectedAccount } : {}),
    ...(context.now ? { now: context.now } : {}),
  });
  if (!authorization.allowed) {
    return deny(authorization.reason, authorization.reason, authority);
  }

  if (enforceOperationalReadiness) {
    if (context.policyVersion !== policy.policyVersion) {
      return deny(
        'POLICY_VERSION_MISMATCH',
        'Runtime policy version does not match the effective policy.',
        authority,
      );
    }
    if (!context.descriptorSha256 || !/^[a-f0-9]{64}$/.test(context.descriptorSha256)) {
      return deny(
        'DESCRIPTOR_SHA256_REQUIRED',
        'A valid immutable descriptor SHA-256 is required.',
        authority,
      );
    }
    if (!context.idempotencyKey?.trim()) {
      return deny(
        'IDEMPOTENCY_KEY_REQUIRED',
        'A deterministic idempotency key is required.',
        authority,
      );
    }
    if (!context.readiness?.ready) {
      const suffix = context.readiness
        ? [...context.readiness.failedChecks, ...context.readiness.unknownChecks].join(',')
        : 'MISSING';
      return deny(
        `AUTOPILOT_NOT_READY:${suffix}`,
        'Autopilot readiness is not fully green for this exact policy and runtime.',
        authority,
      );
    }
    const providerHealth = context.providerHealth;
    if (
      !providerHealth ||
      providerHealth.provider !== tool.provider ||
      providerHealth.tenantId !== tenantId ||
      providerHealth.status !== 'HEALTHY' ||
      providerHealth.circuit !== 'CLOSED' ||
      normalizeEvidence(providerHealth.evidence).length === 0
    ) {
      return deny(
        'PROVIDER_HEALTH_NOT_READY',
        'Provider health and tenant circuit must be verified before a side effect.',
        authority,
      );
    }
    if (Date.parse(providerHealth.checkedAt) > Date.parse(now)) {
      return deny(
        'PROVIDER_HEALTH_FROM_FUTURE',
        'Provider health evidence has an invalid future timestamp.',
        authority,
      );
    }
  }

  if (mode === 'OBSERVE' || mode === 'ASSISTED') {
    return deny(
      'AUTONOMY_MODE_EXTERNAL_DISABLED',
      `Autonomy mode ${mode} does not execute external side effects.`,
      authority,
    );
  }

  if (authority === 'AUTO_EXTERNAL_PREAPPROVED') {
    const classId = context.preapprovedClassId?.trim();
    const candidate = classId
      ? compiled.activePreapprovedClass(classId, {
          capabilityId: tool.name,
          provider: tool.provider,
          tenantId,
        })
      : undefined;
    if (!candidate || mode !== 'PREAPPROVED_AUTO') {
      return requireApproval(
        'PREAPPROVED_CLASS_NOT_ACTIVE',
        'Preapproved authority is unavailable; explicit approval is required.',
        authority,
        baseEvidence,
        mode,
        policy.policyVersion,
      );
    }
    return allow(
      'PREAPPROVED_CLASS_ALLOWED',
      'A formally active preapproved class authorizes this bounded side effect.',
      authority,
      normalizeEvidence([...baseEvidence, ...candidate.decisionEvidence]),
      false,
      mode,
      policy.policyVersion,
    );
  }

  if (requiresFormalApproval(tool)) {
    const expectation = approvalExpectation(tool, context, routeId);
    if (!context.approval || !expectation) {
      return requireApproval(
        'APPROVAL_REQUIRED',
        `Risk class ${tool.riskClass} requires a formal ApprovalRecord bound to the authenticated principal.`,
        authority,
        baseEvidence,
        mode,
        policy.policyVersion,
      );
    }
    const verification = verifyApproval(context.approval, expectation, context.now);
    if (!verification.valid) {
      return requireApproval(
        `APPROVAL_INVALID:${verification.reasons.join(',')}`,
        `ApprovalRecord failed validation: ${verification.reasons.join(',')}.`,
        authority,
        baseEvidence,
        mode,
        policy.policyVersion,
      );
    }
  }

  return allow(
    'AUTONOMY_GATE_ALLOWED',
    'Autonomy, policy, approval and operational readiness requirements are satisfied.',
    authority,
    normalizeEvidence([
      ...baseEvidence,
      ...(context.readiness?.evidence ?? []),
      ...(context.providerHealth?.evidence ?? []),
      ...(context.approval?.evidence ?? []),
    ]),
    false,
    mode,
    policy.policyVersion,
  );

  function deny(
    reasonCode: string,
    reason: string,
    gateAuthority: AutonomyGateResult['authority'],
  ): AutonomyGateResult {
    return {
      decision: 'DENY',
      reasonCode,
      reason,
      evidence: baseEvidence,
      authority: gateAuthority,
      mode,
      policyVersion: policy.policyVersion,
      shadowOnly: false,
    };
  }
}

export function requiresFormalApproval(tool: ToolDefinition): boolean {
  return approvalRiskClasses.has(tool.riskClass);
}

function approvalExpectation(
  tool: ToolDefinition,
  context: AutonomyGateContext,
  routeId: string | undefined,
): ApprovalExpectation | undefined {
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
    routeId: routeId as ApprovalExpectation['routeId'],
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

function activeKillSwitch(
  tool: ToolDefinition,
  context: AutonomyGateContext,
  tenantId: string,
): string | undefined {
  const globalActive =
    context.platformKillSwitch ?? mutationKillSwitchEnv('TOCA_PLATFORM_KILL_SWITCH');
  if (globalActive) return 'KILL_SWITCH_GLOBAL';
  if (context.tenantKillSwitch) return `KILL_SWITCH_TENANT:${tenantId}`;
  if (context.providerKillSwitches?.includes(tool.provider)) {
    return `KILL_SWITCH_PROVIDER:${tool.provider}`;
  }
  if (context.capabilityKillSwitches?.includes(tool.name)) {
    return `KILL_SWITCH_CAPABILITY:${tool.name}`;
  }
  return undefined;
}

function mutationKillSwitchEnv(name: string): boolean {
  const configured = process.env[name]?.trim().toLowerCase();
  return configured === 'true' || configured === '1' || configured === 'on';
}

function normalizeOperation(capabilityId: string, operation: string | undefined): string {
  if (capabilityId.startsWith('instagram.publish.')) return 'PUBLISH';
  if (capabilityId === 'instagram.toca_schedule.create') return 'SCHEDULE';
  if (capabilityId === 'instagram.toca_schedule.reschedule') return 'RESCHEDULE';
  if (capabilityId === 'instagram.toca_schedule.cancel') return 'CANCEL';
  return (
    operation?.trim().toUpperCase() || (capabilityId.endsWith('.prepare') ? 'PREPARE' : 'READ')
  );
}

function isUnavailableStatus(status: ToolDefinition['capabilityStatus']): boolean {
  return ['SUSPENDED', 'REMOVED', 'DISABLED', 'RETIRED', 'BLOCKED'].includes(status);
}

function allow(
  reasonCode: string,
  reason: string,
  authority: AutonomyGateResult['authority'],
  evidence: readonly string[],
  shadowOnly: boolean,
  mode: AutonomyMode,
  policyVersion: string,
): AutonomyGateResult {
  return {
    decision: 'ALLOW',
    reasonCode,
    reason,
    evidence,
    authority,
    mode,
    policyVersion,
    shadowOnly,
  };
}

function requireApproval(
  reasonCode: string,
  reason: string,
  authority: AutonomyGateResult['authority'],
  evidence: readonly string[],
  mode: AutonomyMode,
  policyVersion: string,
): AutonomyGateResult {
  return {
    decision: 'REQUIRE_APPROVAL',
    reasonCode,
    reason,
    evidence,
    authority,
    mode,
    policyVersion,
    shadowOnly: false,
  };
}

function normalizeEvidence(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
