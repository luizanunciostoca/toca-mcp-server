import { describe, expect, it } from 'vitest';
import type { CapabilityStatus, ToolDefinition } from '../src/core/tool-registry.js';
import { CAPABILITY_CATALOG } from '../src/governance/capability-catalog.js';
import type { ProviderCapabilityValidationEvidence } from '../src/governance/capability-validation-evidence.js';
import { buildLiveCapabilityMatrix } from '../src/governance/live-capability-matrix.js';
import type { CapabilityDefinition } from '../src/governance/types.js';

const SHA = 'a'.repeat(40);
const NOW = '2026-10-05T12:00:00Z';

describe('TOCA-MAX live capability matrix projection', () => {
  it('materializes exactly one conservative closure record per canonical capability', () => {
    const matrix = buildLiveCapabilityMatrix(CAPABILITY_CATALOG, {
      exactHeadSha: SHA,
      now: NOW,
    });

    expect(matrix.total).toBe(796);
    expect(new Set(matrix.records.map((record) => record.capability_id)).size).toBe(796);
    expect(
      matrix.records.every(
        (record) =>
          record.owner.length > 0 &&
          record.provider_identity.length > 0 &&
          record.semantic_assertion.includes(
            'closure never exceeds observed runtime/provider proof',
          ),
      ),
    ).toBe(true);
    expect(matrix.records.some((record) => record.closure_state === 'PRODUCTION_VERIFIED')).toBe(
      false,
    );
  });

  it('defers Google Ads, WhatsApp and SendGrid/email provider closure to the final phase', () => {
    const matrix = buildLiveCapabilityMatrix(CAPABILITY_CATALOG, {
      exactHeadSha: SHA,
      now: NOW,
    });

    for (const prefix of ['google_ads.', 'whatsapp.', 'email.']) {
      const records = matrix.records.filter((record) => record.capability_id.startsWith(prefix));
      expect(records.length, prefix).toBeGreaterThan(0);
      expect(
        records.every((record) => record.closure_state === 'DEFERRED'),
        prefix,
      ).toBe(true);
      expect(
        records.every((record) => record.blocker === 'DEFERRED_FINAL_PROVIDER_PHASE'),
        prefix,
      ).toBe(true);
      expect(
        records.every((record) => record.next_action === 'FINAL_PROVIDER_PHASE'),
        prefix,
      ).toBe(true);
    }
  });

  it('does not trust a source PRODUCTION_VALIDATED label without active proof', () => {
    const definition = requireBaseDefinition();
    const productionDefinition = {
      ...definition,
      lifecycle_status: 'PRODUCTION_VALIDATED' as const,
    };

    const matrix = buildLiveCapabilityMatrix([productionDefinition], {
      exactHeadSha: SHA,
      now: NOW,
    });

    expect(matrix.records[0]).toMatchObject({
      source_lifecycle_status: 'PRODUCTION_VALIDATED',
      closure_state: 'NOT_PROVEN',
      evidence_freshness: 'NONE',
      blocker: 'ACTIVE_PRODUCTION_EVIDENCE_REQUIRED',
      readback: 'NOT_PROVEN',
    });
  });

  it.each(['PLANNED', 'DISABLED'] as const)(
    'keeps %s runtime placeholders fail-closed even when a binding ID is supplied',
    (status) => {
      const base = requireBaseDefinition();
      const definition = {
        ...base,
        lifecycle_status: status,
        execution_surface: 'MCP_TOOL' as const,
      };
      const runtimeTool = runtimeToolFor(definition, status);

      const matrix = buildLiveCapabilityMatrix([definition], {
        exactHeadSha: SHA,
        now: NOW,
        runtimeIdentity: 'runtime:prod:example',
        observedRuntimeTools: [runtimeTool],
        observedRuntimeBindingIds: [definition.capability_id],
      });

      expect(matrix.records[0]).toMatchObject({
        runtime_registered: true,
        runtime_metadata_aligned: true,
        runtime_binding_observed: true,
        runtime_eligible: false,
        blocker: 'RUNTIME_STATUS_NOT_ELIGIBLE',
      });
      expect(matrix.records[0]?.closure_state).not.toBe('RUNTIME_BOUND');
      expect(matrix.records[0]?.closure_state).not.toBe('PRODUCTION_VERIFIED');
    },
  );

  it('does not promote a registered tool when runtime provider or lifecycle metadata disagrees', () => {
    const base = requireBaseDefinition();
    const definition = { ...base, lifecycle_status: 'IMPLEMENTED' as const };
    const runtimeTool: ToolDefinition = {
      ...runtimeToolFor(definition, 'CONNECTED'),
      provider: 'mismatched-provider',
    };

    const matrix = buildLiveCapabilityMatrix([definition], {
      exactHeadSha: SHA,
      now: NOW,
      runtimeIdentity: 'runtime:prod:example',
      observedRuntimeTools: [runtimeTool],
      observedRuntimeBindingIds: [definition.capability_id],
    });

    expect(matrix.records[0]).toMatchObject({
      closure_state: 'IMPLEMENTED',
      runtime_registered: true,
      runtime_metadata_aligned: false,
      runtime_eligible: false,
      blocker: 'RUNTIME_METADATA_MISMATCH',
      readback: 'NOT_PROVEN',
    });
  });

  it.each([
    ['wrong head', { exactHeadSha: 'b'.repeat(40) }, 'CAPABILITY_EVIDENCE_EXACT_HEAD_MISMATCH'],
    ['wrong provider', { provider: 'wrong-provider' }, 'CAPABILITY_EVIDENCE_PROVIDER_MISMATCH'],
    [
      'missing evidence classes',
      { evidence: ['artifact:one', 'artifact:two', 'artifact:three'] },
      'CAPABILITY_EVIDENCE_REQUIRED_CLASSES_MISSING',
    ],
  ] as const)(
    'rejects current-looking provider evidence with %s',
    (_label, override, expectedError) => {
      const definition = productionDefinition();
      const runtimeTool = runtimeToolFor(definition, 'PRODUCTION_VALIDATED');
      const evidence = {
        ...validEvidence(definition),
        ...override,
      } as ProviderCapabilityValidationEvidence;

      const matrix = buildLiveCapabilityMatrix([definition], {
        exactHeadSha: SHA,
        now: NOW,
        runtimeIdentity: 'runtime:prod:example',
        observedRuntimeTools: [runtimeTool],
        observedRuntimeBindingIds: [definition.capability_id],
        providerEvidence: [evidence],
      });

      expect(matrix.records[0]?.closure_state).toBe('RUNTIME_BOUND');
      expect(matrix.records[0]?.closure_state).not.toBe('PRODUCTION_VERIFIED');
      expect(matrix.records[0]?.evidence_validation_error).toContain(expectedError);
      expect(matrix.records[0]?.readback).toBe('RUNTIME_BINDING_OBSERVED');
    },
  );

  it.each([
    [
      'expired',
      { validatedAt: '2026-09-01T10:00:00Z', expiresAt: '2026-10-01T10:00:00Z' },
      'EXPIRED',
      'EXPIRED_PROVIDER_EVIDENCE',
    ],
    [
      'future',
      { validatedAt: '2026-10-06T10:00:00Z', expiresAt: '2026-11-06T10:00:00Z' },
      'FUTURE',
      'FUTURE_PROVIDER_EVIDENCE',
    ],
  ] as const)(
    'preserves %s evidence identity without treating it as current proof',
    (_label, override, expectedFreshness, expectedBlocker) => {
      const definition = productionDefinition();
      const evidence = {
        ...validEvidence(definition),
        ...override,
      } as ProviderCapabilityValidationEvidence;

      const matrix = buildLiveCapabilityMatrix([definition], {
        exactHeadSha: SHA,
        now: NOW,
        providerEvidence: [evidence],
      });

      expect(matrix.records[0]).toMatchObject({
        evidence_exact_head_sha: SHA,
        provider_resource_id: 'resource-1',
        evidence_freshness: expectedFreshness,
        blocker: expectedBlocker,
        readback: 'NOT_PROVEN',
      });
      expect(matrix.records[0]?.evidence_validation_error).toContain('CAPABILITY_EVIDENCE_');
      expect(matrix.records[0]?.closure_state).not.toBe('PROVIDER_VERIFIED');
      expect(matrix.records[0]?.closure_state).not.toBe('PRODUCTION_VERIFIED');
    },
  );

  it('promotes only when validated provider proof and an eligible observed runtime binding agree', () => {
    const definition = productionDefinition();
    const runtimeTool = runtimeToolFor(definition, 'PRODUCTION_VALIDATED');
    const evidence = validEvidence(definition);

    const matrix = buildLiveCapabilityMatrix([definition], {
      exactHeadSha: SHA,
      now: NOW,
      runtimeIdentity: 'runtime:prod:example',
      observedRuntimeTools: [runtimeTool],
      observedRuntimeBindingIds: [definition.capability_id],
      providerEvidence: [evidence],
    });

    expect(matrix.records[0]).toMatchObject({
      closure_state: 'PRODUCTION_VERIFIED',
      runtime_registered: true,
      runtime_metadata_aligned: true,
      runtime_binding_observed: true,
      runtime_eligible: true,
      runtime_identity: 'runtime:prod:example',
      evidence_freshness: 'CURRENT',
      evidence_validation_error: null,
      provider_resource_id: 'resource-1',
      evidence_exact_head_sha: SHA,
      blocker: null,
      next_action: 'NONE',
      readback: 'PROVIDER_READBACK_VERIFIED',
    });
  });
});

function requireBaseDefinition(): CapabilityDefinition {
  const definition = CAPABILITY_CATALOG.find(
    (candidate) =>
      !candidate.capability_id.startsWith('google_ads.') &&
      !candidate.capability_id.startsWith('whatsapp.') &&
      !candidate.capability_id.startsWith('email.') &&
      candidate.risk_class === 'READ',
  );
  expect(definition).toBeDefined();
  if (!definition) throw new Error('TEST_CAPABILITY_NOT_FOUND');
  return definition;
}

function productionDefinition(): CapabilityDefinition {
  return {
    ...requireBaseDefinition(),
    lifecycle_status: 'PRODUCTION_VALIDATED',
    execution_surface: 'MCP_TOOL',
  };
}

function runtimeToolFor(
  definition: CapabilityDefinition,
  capabilityStatus: CapabilityStatus,
): ToolDefinition {
  return {
    name: definition.capability_id,
    version: definition.version,
    provider: definition.provider,
    riskClass: definition.risk_class,
    requiredScopes: definition.required_scopes,
    capabilityStatus,
    sideEffects: definition.side_effects,
    idempotent: definition.idempotent,
  };
}

function validEvidence(definition: CapabilityDefinition): ProviderCapabilityValidationEvidence {
  return {
    validationId: 'matrix-proof',
    capabilityId: definition.capability_id,
    provider: definition.provider,
    environment: 'production',
    status: 'PRODUCTION_VALIDATED',
    exactHeadSha: SHA,
    validatedAt: '2026-10-05T10:00:00Z',
    expiresAt: '2026-11-05T10:00:00Z',
    checks: {
      providerWriteSucceeded: true,
      providerReadbackVerified: true,
      idempotencyVerified: true,
      reconciliationVerified: true,
      unknownOutcomeFailClosed: true,
    },
    externalResourceId: 'resource-1',
    evidence: ['provider:one', 'readback:one', 'acceptance:one'],
  };
}
