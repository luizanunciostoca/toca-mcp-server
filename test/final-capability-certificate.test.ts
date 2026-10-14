import { describe, expect, it } from 'vitest';
import {
  buildFinalCapabilityCertificate,
  FINAL_CAPABILITY_GATE_IDS,
  type FinalCapabilityGateEvidence,
} from '../src/governance/final-capability-certificate.js';
import type { LiveCapabilityMatrix } from '../src/governance/live-capability-matrix.js';
import type { RouteAcceptanceMatrix } from '../src/governance/route-acceptance.js';

const SHA = 'a'.repeat(40);

describe('TOCA-MAX final capability certificate', () => {
  it('returns COMPLETE only with all capabilities/routes and every required current gate proven', () => {
    const certificate = buildFinalCapabilityCertificate({
      exactHeadSha: SHA,
      liveMatrix: liveMatrix({ productionVerified: 10, total: 10, finalProviderPhaseOpen: true }),
      routeAcceptance: routeAcceptance({ productionVerified: 32 }),
      gates: provenGates(),
    });

    expect(certificate).toMatchObject({
      verdict: 'COMPLETE',
      capability_total: 10,
      capability_production_verified: 10,
      route_total: 32,
      route_production_verified: 32,
      final_provider_phase_open: true,
      unresolved: [],
    });
  });

  it('stays PARTIAL while the owner-deferred final provider phase is still closed', () => {
    const certificate = buildFinalCapabilityCertificate({
      exactHeadSha: SHA,
      liveMatrix: liveMatrix({
        productionVerified: 6,
        total: 10,
        deferred: 4,
        finalProviderPhaseOpen: false,
      }),
      routeAcceptance: routeAcceptance({
        productionVerified: 28,
        deferredFinalProvider: 4,
      }),
      gates: provenGates().map((gate) =>
        isFinalProviderGate(gate.id)
          ? { ...gate, state: 'DEFERRED' as const, exact_head_sha: null, evidence: [] }
          : gate,
      ),
    });

    expect(certificate.verdict).toBe('PARTIAL');
    expect(certificate.unresolved).toContain('FINAL_PROVIDER_PHASE_CLOSED');
    expect(certificate.unresolved).toContain('CAPABILITIES_DEFERRED:4');
    expect(certificate.unresolved).toContain('ROUTES_DEFERRED_FINAL_PROVIDER_PHASE:4');
  });

  it('returns NOT_PROVEN when final phase is open but required current proof is missing', () => {
    const gates = provenGates().map((gate) =>
      gate.id === 'DR_CURRENT_SCHEMA'
        ? { ...gate, state: 'NOT_PROVEN' as const, exact_head_sha: null, evidence: [] }
        : gate,
    );
    const certificate = buildFinalCapabilityCertificate({
      exactHeadSha: SHA,
      liveMatrix: liveMatrix({ productionVerified: 10, total: 10, finalProviderPhaseOpen: true }),
      routeAcceptance: routeAcceptance({ productionVerified: 32 }),
      gates,
    });

    expect(certificate.verdict).toBe('NOT_PROVEN');
    expect(certificate.unresolved).toContain('GATE_NOT_PROVEN:DR_CURRENT_SCHEMA');
  });

  it('returns BLOCKED when a required gate or route is explicitly blocked', () => {
    const gates = provenGates().map((gate) =>
      gate.id === 'ROLLBACK_KILLSWITCH_CURRENT'
        ? {
            ...gate,
            state: 'BLOCKED' as const,
            exact_head_sha: null,
            evidence: ['blocker:readback'],
          }
        : gate,
    );
    const certificate = buildFinalCapabilityCertificate({
      exactHeadSha: SHA,
      liveMatrix: liveMatrix({ productionVerified: 10, total: 10, finalProviderPhaseOpen: true }),
      routeAcceptance: routeAcceptance({ productionVerified: 31, blocked: 1 }),
      gates,
    });

    expect(certificate.verdict).toBe('BLOCKED');
    expect(certificate.unresolved).toContain('GATE_BLOCKED:ROLLBACK_KILLSWITCH_CURRENT');
    expect(certificate.unresolved).toContain('ROUTES_BLOCKED:1');
  });

  it('rejects proven gate evidence from another SHA', () => {
    const gates = provenGates().map((gate) =>
      gate.id === 'DRIFT_WATCH_RUNTIME' ? { ...gate, exact_head_sha: 'b'.repeat(40) } : gate,
    );

    expect(() =>
      buildFinalCapabilityCertificate({
        exactHeadSha: SHA,
        liveMatrix: liveMatrix({ productionVerified: 10, total: 10, finalProviderPhaseOpen: true }),
        routeAcceptance: routeAcceptance({ productionVerified: 32 }),
        gates,
      }),
    ).toThrow('FINAL_CERTIFICATE_GATE_HEAD_MISMATCH:DRIFT_WATCH_RUNTIME');
  });

  it('rejects missing and duplicate gate records', () => {
    const gates = provenGates();
    expect(() =>
      buildFinalCapabilityCertificate({
        exactHeadSha: SHA,
        liveMatrix: liveMatrix({ productionVerified: 10, total: 10, finalProviderPhaseOpen: true }),
        routeAcceptance: routeAcceptance({ productionVerified: 32 }),
        gates: gates.slice(1),
      }),
    ).toThrow('FINAL_CERTIFICATE_GATE_MISSING:EXACT_HEAD_CERTIFICATION');

    expect(() =>
      buildFinalCapabilityCertificate({
        exactHeadSha: SHA,
        liveMatrix: liveMatrix({ productionVerified: 10, total: 10, finalProviderPhaseOpen: true }),
        routeAcceptance: routeAcceptance({ productionVerified: 32 }),
        gates: [...gates, gates[0]!],
      }),
    ).toThrow('FINAL_CERTIFICATE_GATE_DUPLICATE:EXACT_HEAD_CERTIFICATION');
  });
});

function provenGates(): FinalCapabilityGateEvidence[] {
  return FINAL_CAPABILITY_GATE_IDS.map((id) => ({
    id,
    state: 'PROVEN',
    exact_head_sha: SHA,
    evidence: [`evidence:${id}`],
  }));
}

function isFinalProviderGate(id: string): boolean {
  return [
    'GOOGLE_BUSINESS_PROVIDER',
    'GOOGLE_ADS_PROVIDER',
    'WHATSAPP_PROVIDER',
    'SENDGRID_PROVIDER',
  ].includes(id);
}

function liveMatrix(options: {
  productionVerified: number;
  total: number;
  deferred?: number;
  blocked?: number;
  notProven?: number;
  finalProviderPhaseOpen: boolean;
}): LiveCapabilityMatrix {
  const deferred = options.deferred ?? 0;
  const blocked = options.blocked ?? 0;
  const notProven = options.notProven ?? 0;
  const implemented = options.total - options.productionVerified - deferred - blocked - notProven;
  const states = [
    ...Array.from({ length: options.productionVerified }, () => 'PRODUCTION_VERIFIED' as const),
    ...Array.from({ length: deferred }, () => 'DEFERRED' as const),
    ...Array.from({ length: blocked }, () => 'BLOCKED' as const),
    ...Array.from({ length: notProven }, () => 'NOT_PROVEN' as const),
    ...Array.from({ length: implemented }, () => 'IMPLEMENTED' as const),
  ];
  return {
    exact_head_sha: SHA,
    generated_at: '2026-10-06T20:00:00Z',
    runtime_identity: 'runtime:test',
    final_provider_phase_open: options.finalProviderPhaseOpen,
    total: options.total,
    records: states.map((closureState, index) => ({
      capability_id: `test.capability_${index}`,
      route_id: 'R01',
      owner: 'AG-01',
      source_lifecycle_status: 'PRODUCTION_VALIDATED',
      closure_state: closureState,
      execution_surface: 'MCP_TOOL',
      runtime_registered: true,
      runtime_status: 'PRODUCTION_VALIDATED',
      runtime_provider: 'test',
      runtime_metadata_aligned: true,
      runtime_binding_observed: true,
      runtime_eligible: true,
      runtime_identity: 'runtime:test',
      provider_identity: 'test',
      provider_resource_id: `resource-${index}`,
      evidence_exact_head_sha: SHA,
      evidence_freshness: 'CURRENT',
      evidence_validation_error: null,
      semantic_assertion: 'test',
      readback: 'PROVIDER_READBACK_VERIFIED',
      blocker: null,
      next_action: 'NONE',
      deferred_final_provider_phase: closureState === 'DEFERRED',
      exact_head_sha: SHA,
    })),
    counts_by_state: {
      DOCUMENTED: 0,
      IMPLEMENTED: implemented,
      INTEGRATED: 0,
      RUNTIME_BOUND: 0,
      PROVIDER_VERIFIED: 0,
      PRODUCTION_VERIFIED: options.productionVerified,
      BLOCKED: blocked,
      DEFERRED: deferred,
      NOT_PROVEN: notProven,
    },
  };
}

function routeAcceptance(options: {
  productionVerified: number;
  deferredFinalProvider?: number;
  blocked?: number;
  notProven?: number;
}): RouteAcceptanceMatrix {
  const deferred = options.deferredFinalProvider ?? 0;
  const blocked = options.blocked ?? 0;
  const notProven = options.notProven ?? 0;
  const remaining = 32 - options.productionVerified - deferred - blocked - notProven;
  if (remaining !== 0) throw new Error('TEST_ROUTE_COUNTS_MUST_SUM_TO_32');
  const states = [
    ...Array.from({ length: options.productionVerified }, () => 'PRODUCTION_VERIFIED' as const),
    ...Array.from({ length: deferred }, () => 'DEFERRED_FINAL_PROVIDER_PHASE' as const),
    ...Array.from({ length: blocked }, () => 'BLOCKED' as const),
    ...Array.from({ length: notProven }, () => 'NOT_PROVEN' as const),
  ];
  return {
    exact_head_sha: SHA,
    route_total: 32,
    records: states.map((proofState, index) => ({
      route_id:
        `R${String(index + 1).padStart(2, '0')}` as RouteAcceptanceMatrix['records'][number]['route_id'],
      route_name: `route-${index + 1}`,
      structural_state: 'PASS',
      proof_state: proofState,
      capability_total: 1,
      deferred_final_provider_count: proofState === 'DEFERRED_FINAL_PROVIDER_PHASE' ? 1 : 0,
      non_deferred_count: proofState === 'DEFERRED_FINAL_PROVIDER_PHASE' ? 0 : 1,
      non_deferred_production_verified_count: proofState === 'PRODUCTION_VERIFIED' ? 1 : 0,
      blocked_non_deferred_count: proofState === 'BLOCKED' ? 1 : 0,
      counts_by_closure_state: {
        DOCUMENTED: 0,
        IMPLEMENTED: 0,
        INTEGRATED: 0,
        RUNTIME_BOUND: 0,
        PROVIDER_VERIFIED: 0,
        PRODUCTION_VERIFIED: proofState === 'PRODUCTION_VERIFIED' ? 1 : 0,
        BLOCKED: proofState === 'BLOCKED' ? 1 : 0,
        DEFERRED: proofState === 'DEFERRED_FINAL_PROVIDER_PHASE' ? 1 : 0,
        NOT_PROVEN: proofState === 'NOT_PROVEN' ? 1 : 0,
      },
      final_provider_capability_ids:
        proofState === 'DEFERRED_FINAL_PROVIDER_PHASE' ? ['provider.deferred'] : [],
      unresolved_non_deferred_capability_ids:
        proofState === 'NOT_PROVEN' || proofState === 'BLOCKED' ? ['capability.unresolved'] : [],
      semantic_assertion: `proof=${proofState}`,
      next_action: proofState === 'PRODUCTION_VERIFIED' ? 'NONE' : 'PROVE',
      exact_head_sha: SHA,
    })),
    structural_pass_count: 32,
    production_verified_count: options.productionVerified,
    deferred_final_provider_count: deferred,
    blocked_count: blocked,
    not_proven_count: notProven,
  };
}
