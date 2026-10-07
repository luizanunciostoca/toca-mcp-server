import type { LiveCapabilityMatrix } from './live-capability-matrix.js';
import type { RouteAcceptanceMatrix } from './route-acceptance.js';

export const FINAL_CAPABILITY_GATE_IDS = [
  'EXACT_HEAD_CERTIFICATION',
  'DRIFT_WATCH_RUNTIME',
  'ROLLBACK_KILLSWITCH_CURRENT',
  'DR_CURRENT_SCHEMA',
  'CREATIVE_VIDEO_PROVIDER',
  'GOOGLE_BUSINESS_PROVIDER',
  'GOOGLE_ADS_PROVIDER',
  'WHATSAPP_PROVIDER',
  'SENDGRID_PROVIDER',
] as const;

export type FinalCapabilityGateId = (typeof FINAL_CAPABILITY_GATE_IDS)[number];
export type FinalCapabilityGateState = 'PROVEN' | 'NOT_PROVEN' | 'DEFERRED' | 'BLOCKED';
export type FinalCapabilityCertificateVerdict = 'COMPLETE' | 'PARTIAL' | 'NOT_PROVEN' | 'BLOCKED';

export interface FinalCapabilityGateEvidence {
  readonly id: FinalCapabilityGateId;
  readonly state: FinalCapabilityGateState;
  readonly exact_head_sha: string | null;
  readonly evidence: readonly string[];
}

export interface FinalCapabilityCertificate {
  readonly exact_head_sha: string;
  readonly verdict: FinalCapabilityCertificateVerdict;
  readonly capability_total: number;
  readonly capability_production_verified: number;
  readonly route_total: number;
  readonly route_production_verified: number;
  readonly final_provider_phase_open: boolean;
  readonly gates: readonly FinalCapabilityGateEvidence[];
  readonly unresolved: readonly string[];
  readonly semantic_assertion: string;
}

export interface BuildFinalCapabilityCertificateOptions {
  readonly exactHeadSha: string;
  readonly liveMatrix: LiveCapabilityMatrix;
  readonly routeAcceptance: RouteAcceptanceMatrix;
  readonly gates: readonly FinalCapabilityGateEvidence[];
}

export function buildFinalCapabilityCertificate(
  options: BuildFinalCapabilityCertificateOptions,
): FinalCapabilityCertificate {
  assertSha(options.exactHeadSha);
  if (options.liveMatrix.exact_head_sha !== options.exactHeadSha) {
    throw new Error('FINAL_CERTIFICATE_LIVE_MATRIX_HEAD_MISMATCH');
  }
  if (options.routeAcceptance.exact_head_sha !== options.exactHeadSha) {
    throw new Error('FINAL_CERTIFICATE_ROUTE_ACCEPTANCE_HEAD_MISMATCH');
  }
  if (
    options.routeAcceptance.route_total !== 32 ||
    options.routeAcceptance.structural_pass_count !== 32
  ) {
    throw new Error('FINAL_CERTIFICATE_R01_R32_STRUCTURAL_ACCEPTANCE_REQUIRED');
  }
  assertLiveMatrixIntegrity(options.liveMatrix);
  assertRouteAcceptanceIntegrity(options.routeAcceptance);

  const gates = validateGates(options.gates, options.exactHeadSha);
  const unresolved = collectUnresolved(options.liveMatrix, options.routeAcceptance, gates);
  const verdict = resolveVerdict(options.liveMatrix, options.routeAcceptance, gates, unresolved);

  return {
    exact_head_sha: options.exactHeadSha,
    verdict,
    capability_total: options.liveMatrix.total,
    capability_production_verified: options.liveMatrix.counts_by_state.PRODUCTION_VERIFIED,
    route_total: options.routeAcceptance.route_total,
    route_production_verified: options.routeAcceptance.production_verified_count,
    final_provider_phase_open: options.liveMatrix.final_provider_phase_open,
    gates,
    unresolved,
    semantic_assertion:
      'COMPLETE requires exact-head evidence, all capabilities and R01-R32 production verified, current resilience proof, and all final providers proven',
  };
}

function validateGates(
  values: readonly FinalCapabilityGateEvidence[],
  exactHeadSha: string,
): readonly FinalCapabilityGateEvidence[] {
  const required = new Set<string>(FINAL_CAPABILITY_GATE_IDS);
  const seen = new Set<string>();

  for (const gate of values) {
    if (!required.has(gate.id)) throw new Error(`FINAL_CERTIFICATE_GATE_UNKNOWN:${gate.id}`);
    if (seen.has(gate.id)) throw new Error(`FINAL_CERTIFICATE_GATE_DUPLICATE:${gate.id}`);
    seen.add(gate.id);

    if (gate.state === 'PROVEN') {
      if (gate.exact_head_sha !== exactHeadSha) {
        throw new Error(`FINAL_CERTIFICATE_GATE_HEAD_MISMATCH:${gate.id}`);
      }
      if (gate.evidence.length === 0 || gate.evidence.some((item) => item.trim().length === 0)) {
        throw new Error(`FINAL_CERTIFICATE_GATE_EVIDENCE_REQUIRED:${gate.id}`);
      }
    }
  }

  for (const gateId of FINAL_CAPABILITY_GATE_IDS) {
    if (!seen.has(gateId)) throw new Error(`FINAL_CERTIFICATE_GATE_MISSING:${gateId}`);
  }

  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

function collectUnresolved(
  matrix: LiveCapabilityMatrix,
  routes: RouteAcceptanceMatrix,
  gates: readonly FinalCapabilityGateEvidence[],
): readonly string[] {
  const unresolved: string[] = [];

  if (!matrix.final_provider_phase_open) unresolved.push('FINAL_PROVIDER_PHASE_CLOSED');
  if (matrix.counts_by_state.DEFERRED > 0) {
    unresolved.push(`CAPABILITIES_DEFERRED:${matrix.counts_by_state.DEFERRED}`);
  }
  if (matrix.counts_by_state.BLOCKED > 0) {
    unresolved.push(`CAPABILITIES_BLOCKED:${matrix.counts_by_state.BLOCKED}`);
  }
  if (matrix.counts_by_state.NOT_PROVEN > 0) {
    unresolved.push(`CAPABILITIES_NOT_PROVEN:${matrix.counts_by_state.NOT_PROVEN}`);
  }
  const productionShortfall = matrix.total - matrix.counts_by_state.PRODUCTION_VERIFIED;
  if (productionShortfall > 0) {
    unresolved.push(`CAPABILITIES_NOT_PRODUCTION_VERIFIED:${productionShortfall}`);
  }

  if (routes.deferred_final_provider_count > 0) {
    unresolved.push(`ROUTES_DEFERRED_FINAL_PROVIDER_PHASE:${routes.deferred_final_provider_count}`);
  }
  if (routes.blocked_count > 0) unresolved.push(`ROUTES_BLOCKED:${routes.blocked_count}`);
  if (routes.not_proven_count > 0) unresolved.push(`ROUTES_NOT_PROVEN:${routes.not_proven_count}`);
  if (routes.production_verified_count !== routes.route_total) {
    unresolved.push(
      `ROUTES_NOT_PRODUCTION_VERIFIED:${routes.route_total - routes.production_verified_count}`,
    );
  }

  for (const gate of gates) {
    if (gate.state !== 'PROVEN') unresolved.push(`GATE_${gate.state}:${gate.id}`);
  }

  return unresolved.sort();
}

function resolveVerdict(
  matrix: LiveCapabilityMatrix,
  routes: RouteAcceptanceMatrix,
  gates: readonly FinalCapabilityGateEvidence[],
  unresolved: readonly string[],
): FinalCapabilityCertificateVerdict {
  if (
    matrix.counts_by_state.BLOCKED > 0 ||
    routes.blocked_count > 0 ||
    gates.some((gate) => gate.state === 'BLOCKED')
  ) {
    return 'BLOCKED';
  }

  const complete =
    unresolved.length === 0 &&
    matrix.final_provider_phase_open &&
    matrix.counts_by_state.PRODUCTION_VERIFIED === matrix.total &&
    routes.production_verified_count === routes.route_total &&
    gates.every((gate) => gate.state === 'PROVEN');
  if (complete) return 'COMPLETE';

  if (
    !matrix.final_provider_phase_open ||
    matrix.counts_by_state.DEFERRED > 0 ||
    routes.deferred_final_provider_count > 0 ||
    gates.some((gate) => gate.state === 'DEFERRED')
  ) {
    return 'PARTIAL';
  }

  return 'NOT_PROVEN';
}

function assertSha(value: string): void {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('FINAL_CERTIFICATE_SHA_INVALID');
}

function assertLiveMatrixIntegrity(matrix: LiveCapabilityMatrix): void {
  if (matrix.total !== matrix.records.length) {
    throw new Error('FINAL_CERTIFICATE_CAPABILITY_TOTAL_MISMATCH');
  }
  const ids = matrix.records.map((record) => record.capability_id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('FINAL_CERTIFICATE_CAPABILITY_DUPLICATE');
  }

  const actual = {
    DOCUMENTED: 0,
    IMPLEMENTED: 0,
    INTEGRATED: 0,
    RUNTIME_BOUND: 0,
    PROVIDER_VERIFIED: 0,
    PRODUCTION_VERIFIED: 0,
    BLOCKED: 0,
    DEFERRED: 0,
    NOT_PROVEN: 0,
  };
  for (const record of matrix.records) {
    if (record.exact_head_sha !== matrix.exact_head_sha) {
      throw new Error(`FINAL_CERTIFICATE_CAPABILITY_HEAD_MISMATCH:${record.capability_id}`);
    }
    actual[record.closure_state] += 1;
  }
  for (const [state, count] of Object.entries(actual)) {
    if (matrix.counts_by_state[state as keyof typeof actual] !== count) {
      throw new Error(`FINAL_CERTIFICATE_CAPABILITY_COUNT_MISMATCH:${state}`);
    }
  }
}

function assertRouteAcceptanceIntegrity(routes: RouteAcceptanceMatrix): void {
  if (routes.records.length !== routes.route_total) {
    throw new Error('FINAL_CERTIFICATE_ROUTE_TOTAL_MISMATCH');
  }
  const ids = routes.records.map((record) => record.route_id);
  if (new Set(ids).size !== ids.length) throw new Error('FINAL_CERTIFICATE_ROUTE_DUPLICATE');

  const actual = {
    production: 0,
    deferred: 0,
    blocked: 0,
    notProven: 0,
  };
  for (const record of routes.records) {
    if (record.exact_head_sha !== routes.exact_head_sha) {
      throw new Error(`FINAL_CERTIFICATE_ROUTE_HEAD_MISMATCH:${record.route_id}`);
    }
    if (record.structural_state !== 'PASS') {
      throw new Error(`FINAL_CERTIFICATE_ROUTE_STRUCTURAL_FAIL:${record.route_id}`);
    }
    if (record.proof_state === 'PRODUCTION_VERIFIED') actual.production += 1;
    else if (record.proof_state === 'DEFERRED_FINAL_PROVIDER_PHASE') actual.deferred += 1;
    else if (record.proof_state === 'BLOCKED') actual.blocked += 1;
    else actual.notProven += 1;
  }

  if (routes.production_verified_count !== actual.production) {
    throw new Error('FINAL_CERTIFICATE_ROUTE_COUNT_MISMATCH:PRODUCTION_VERIFIED');
  }
  if (routes.deferred_final_provider_count !== actual.deferred) {
    throw new Error('FINAL_CERTIFICATE_ROUTE_COUNT_MISMATCH:DEFERRED_FINAL_PROVIDER_PHASE');
  }
  if (routes.blocked_count !== actual.blocked) {
    throw new Error('FINAL_CERTIFICATE_ROUTE_COUNT_MISMATCH:BLOCKED');
  }
  if (routes.not_proven_count !== actual.notProven) {
    throw new Error('FINAL_CERTIFICATE_ROUTE_COUNT_MISMATCH:NOT_PROVEN');
  }
}
