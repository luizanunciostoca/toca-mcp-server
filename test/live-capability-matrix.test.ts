import { describe, expect, it } from 'vitest';
import type { ToolDefinition } from '../src/core/tool-registry.js';
import { CAPABILITY_CATALOG } from '../src/governance/capability-catalog.js';
import type { ProviderCapabilityValidationEvidence } from '../src/governance/capability-validation-evidence.js';
import { buildLiveCapabilityMatrix } from '../src/governance/live-capability-matrix.js';

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
          record.semantic_assertion.includes('closure never exceeds observed runtime/provider proof'),
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
      expect(records.every((record) => record.closure_state === 'DEFERRED'), prefix).toBe(true);
      expect(
        records.every((record) => record.blocker === 'DEFERRED_FINAL_PROVIDER_PHASE'),
        prefix,
      ).toBe(true);
      expect(records.every((record) => record.next_action === 'FINAL_PROVIDER_PHASE'), prefix).toBe(
        true,
      );
    }
  });

  it('does not trust a source PRODUCTION_VALIDATED label without active proof', () => {
    const definition = CAPABILITY_CATALOG.find(
      (candidate) => candidate.lifecycle_status === 'PRODUCTION_VALIDATED',
    );
    expect(definition).toBeDefined();
    if (!definition) return;

    const matrix = buildLiveCapabilityMatrix([definition], {
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

  it('promotes only when active provider evidence and observed runtime identity agree', () => {
    const base = CAPABILITY_CATALOG.find(
      (candidate) => !candidate.capability_id.startsWith('google_ads.'),
    );
    expect(base).toBeDefined();
    if (!base) return;
    const definition = { ...base, lifecycle_status: 'PRODUCTION_VALIDATED' as const };
    const runtimeTool: ToolDefinition = {
      name: definition.capability_id,
      version: definition.version,
      provider: definition.provider,
      riskClass: definition.risk_class,
      requiredScopes: definition.required_scopes,
      capabilityStatus: 'PRODUCTION_VALIDATED',
      sideEffects: definition.side_effects,
      idempotent: definition.idempotent,
    };
    const evidence: ProviderCapabilityValidationEvidence = {
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

    const matrix = buildLiveCapabilityMatrix([definition], {
      exactHeadSha: SHA,
      now: NOW,
      runtimeIdentity: 'runtime:prod:example',
      observedRuntimeTools: [runtimeTool],
      providerEvidence: [evidence],
    });

    expect(matrix.records[0]).toMatchObject({
      closure_state: 'PRODUCTION_VERIFIED',
      runtime_registered: true,
      runtime_identity: 'runtime:prod:example',
      evidence_freshness: 'CURRENT',
      provider_resource_id: 'resource-1',
      blocker: null,
      next_action: 'NONE',
      readback: 'PROVIDER_READBACK_VERIFIED',
    });
  });
});
