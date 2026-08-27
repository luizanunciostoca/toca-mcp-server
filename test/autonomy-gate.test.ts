import { describe, expect, it } from 'vitest';
import { evaluateAutonomyGate } from '../src/core/autonomy-gate.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import type { ToolDefinition } from '../src/core/tool-registry.js';
import {
  hashApprovalDescriptor,
  issueApproval,
  requestApproval,
} from '../src/governance/approval-governance.js';
import { AUTOPILOT_READINESS_CHECKS } from '../src/governance/autonomy-policy.js';
import { evaluateAutopilotReadiness } from '../src/health/autopilot-readiness.js';

const now = '2026-08-26T22:00:00Z';
const tenantId = 'toca';
const accountId = 'instagram-account-1';
const tool: ToolDefinition = {
  name: 'instagram.publish.image',
  version: '1.0.0',
  provider: 'Meta/Instagram',
  riskClass: 'WRITE_EXTERNAL',
  requiredScopes: ['instagram_content_publish'],
  capabilityStatus: 'PRODUCTION_VALIDATED',
  sideEffects: true,
  idempotent: true,
};
const identity = createTrustedServiceExecutionIdentity({
  principalId: 'service:autopilot-test',
  tenantId,
  roles: ['EXTERNAL_WRITER'],
  allowedCapabilityIds: [tool.name],
  allowedTargetAccounts: [accountId],
  evidence: ['test://identity/autopilot'],
  now: '2026-08-26T21:00:00Z',
});
const descriptor = { mediaId: 'media-1', caption: 'TOCA' };
const descriptorSha256 = hashApprovalDescriptor(descriptor);
const readiness = evaluateAutopilotReadiness(
  AUTOPILOT_READINESS_CHECKS.map((name) => ({
    name,
    status: 'PASS' as const,
    evidence: [`readiness:${name.toLowerCase()}:verified`],
    checkedAt: '2026-08-26T21:59:00Z',
  })),
  { now },
);
const providerHealth = {
  provider: tool.provider,
  tenantId,
  status: 'HEALTHY' as const,
  circuit: 'CLOSED' as const,
  evidence: ['provider:meta:health:200'],
  checkedAt: '2026-08-26T21:59:30Z',
};
const requested = requestApproval(
  {
    requester: identity.principal.principalId,
    routeId: 'R02',
    capabilityId: tool.name,
    descriptor,
    targetAccount: accountId,
    scope: [tool.name],
    expiresAt: '2026-08-27T01:00:00Z',
    evidence: ['approval:request:test'],
    correlationId: 'corr-autonomy-gate',
  },
  { now: '2026-08-26T21:55:00Z', createId: () => 'approval-autonomy-gate' },
);
const approval = issueApproval(requested, {
  authority: {
    approver: 'operator:authorized',
    allowedRouteIds: ['R02'],
    allowedCapabilityIds: [tool.name],
    allowedTargetAccounts: [accountId],
    maxFinancialCeiling: null,
    validatedAt: '2026-08-26T21:56:00Z',
    evidence: ['drive://approval-authority/autonomy-gate-test'],
  },
  evidence: ['approval:issued:test'],
  now: '2026-08-26T21:57:00Z',
});

const readyContext = () => ({
  identity,
  connectedAccount: accountId,
  approval,
  descriptorSha256,
  idempotencyKey: 'publication:media-1:v1',
  requiredApprovalScope: [tool.name],
  now,
  policyVersion: '1.1.0',
  autonomyMode: 'SUPERVISED_AUTO' as const,
  readiness,
  providerHealth,
});

describe('Autonomy Gate', () => {
  it('allows an exact approved side effect only when policy, readiness and provider health are green', () => {
    const result = evaluateAutonomyGate(tool, readyContext());
    expect(result.decision).toBe('ALLOW');
    expect(result.reasonCode).toBe('AUTONOMY_GATE_ALLOWED');
    expect(result.authority).toBe('EXPLICIT_APPROVAL');
    expect(result.evidence).toContain('provider:meta:health:200');
  });

  it('fails closed when readiness is absent or policy version drifts', () => {
    const { readiness: verifiedReadiness, ...withoutReadiness } = readyContext();
    expect(verifiedReadiness.ready).toBe(true);
    expect(evaluateAutonomyGate(tool, withoutReadiness).reasonCode).toBe(
      'AUTOPILOT_NOT_READY:MISSING',
    );
    expect(
      evaluateAutonomyGate(tool, { ...readyContext(), policyVersion: '1.0.0' }).reasonCode,
    ).toBe('POLICY_VERSION_MISMATCH');
  });

  it('blocks external effects in assisted mode and when provider circuit is open', () => {
    expect(
      evaluateAutonomyGate(tool, { ...readyContext(), autonomyMode: 'ASSISTED' }).reasonCode,
    ).toBe('AUTONOMY_MODE_NOT_ALLOWED');
    expect(
      evaluateAutonomyGate(tool, {
        ...readyContext(),
        providerHealth: { ...providerHealth, circuit: 'OPEN' },
      }).reasonCode,
    ).toBe('PROVIDER_HEALTH_NOT_READY');
  });

  it('applies kill switches with global, tenant, provider and capability granularity', () => {
    expect(
      evaluateAutonomyGate(tool, { ...readyContext(), platformKillSwitch: true }).reasonCode,
    ).toBe('KILL_SWITCH_GLOBAL');
    expect(
      evaluateAutonomyGate(tool, { ...readyContext(), tenantKillSwitch: true }).reasonCode,
    ).toBe('KILL_SWITCH_TENANT:toca');
    expect(
      evaluateAutonomyGate(tool, {
        ...readyContext(),
        providerKillSwitches: [tool.provider],
      }).reasonCode,
    ).toBe('KILL_SWITCH_PROVIDER:Meta/Instagram');
    expect(
      evaluateAutonomyGate(tool, {
        ...readyContext(),
        capabilityKillSwitches: [tool.name],
      }).reasonCode,
    ).toBe('KILL_SWITCH_CAPABILITY:instagram.publish.image');
  });

  it('requires a fresh approval when the descriptor no longer matches', () => {
    const result = evaluateAutonomyGate(tool, {
      ...readyContext(),
      descriptorSha256: 'b'.repeat(64),
    });
    expect(result.decision).toBe('REQUIRE_APPROVAL');
    expect(result.reasonCode).toContain('APPROVAL_INVALID');
    expect(result.reasonCode).toContain('DESCRIPTOR_MISMATCH');
  });

  it('allows shadow-only internal decisions in observe mode', () => {
    const result = evaluateAutonomyGate(
      {
        name: 'system.health',
        version: '1.0.0',
        provider: 'system',
        riskClass: 'READ',
        requiredScopes: [],
        capabilityStatus: 'IMPLEMENTED',
        sideEffects: false,
        idempotent: true,
      },
      { requester: 'observer', autonomyMode: 'OBSERVE' },
    );
    expect(result.decision).toBe('ALLOW');
    expect(result.shadowOnly).toBe(true);
    expect(result.reasonCode).toBe('AUTONOMY_SHADOW_ALLOWED');
  });
});
