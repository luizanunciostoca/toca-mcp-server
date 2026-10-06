import type { CapabilityClosureState, LiveCapabilityMatrix } from './live-capability-matrix.js';
import type { RouteDefinition, RouteId } from './types.js';

export type RouteStructuralState = 'PASS';
export type RouteProofState =
  'PRODUCTION_VERIFIED' | 'DEFERRED_FINAL_PROVIDER_PHASE' | 'BLOCKED' | 'NOT_PROVEN';

export interface RouteAcceptanceRecord {
  readonly route_id: RouteId;
  readonly route_name: string;
  readonly structural_state: RouteStructuralState;
  readonly proof_state: RouteProofState;
  readonly capability_total: number;
  readonly deferred_final_provider_count: number;
  readonly non_deferred_count: number;
  readonly non_deferred_production_verified_count: number;
  readonly blocked_non_deferred_count: number;
  readonly counts_by_closure_state: Readonly<Record<CapabilityClosureState, number>>;
  readonly final_provider_capability_ids: readonly string[];
  readonly unresolved_non_deferred_capability_ids: readonly string[];
  readonly semantic_assertion: string;
  readonly next_action: string;
  readonly exact_head_sha: string;
}

export interface RouteAcceptanceMatrix {
  readonly exact_head_sha: string;
  readonly route_total: number;
  readonly records: readonly RouteAcceptanceRecord[];
  readonly structural_pass_count: number;
  readonly production_verified_count: number;
  readonly deferred_final_provider_count: number;
  readonly blocked_count: number;
  readonly not_proven_count: number;
}

export function buildRouteAcceptanceMatrix(
  routes: readonly RouteDefinition[],
  capabilities: LiveCapabilityMatrix,
): RouteAcceptanceMatrix {
  const routeIds = routes.map((route) => route.routeId);
  if (new Set(routeIds).size !== routes.length) {
    throw new Error('ROUTE_ACCEPTANCE_DUPLICATE_ROUTE');
  }

  const byCapability = new Map(
    capabilities.records.map((record) => [record.capability_id, record] as const),
  );

  const records = routes.map((route) => {
    if (route.capabilityIds.length === 0) {
      throw new Error(`ROUTE_ACCEPTANCE_EMPTY_ROUTE:${route.routeId}`);
    }
    if (new Set(route.capabilityIds).size !== route.capabilityIds.length) {
      throw new Error(`ROUTE_ACCEPTANCE_DUPLICATE_CAPABILITY:${route.routeId}`);
    }

    const routeCapabilities = route.capabilityIds.map((capabilityId) => {
      const record = byCapability.get(capabilityId);
      if (!record) {
        throw new Error(`ROUTE_ACCEPTANCE_CAPABILITY_MISSING:${route.routeId}:${capabilityId}`);
      }
      if (record.exact_head_sha !== capabilities.exact_head_sha) {
        throw new Error(
          `ROUTE_ACCEPTANCE_HEAD_MISMATCH:${route.routeId}:${capabilityId}:${record.exact_head_sha}`,
        );
      }
      return record;
    });

    const deferred = routeCapabilities.filter((record) => record.deferred_final_provider_phase);
    for (const record of deferred) {
      if (
        record.closure_state !== 'DEFERRED' ||
        record.blocker !== 'DEFERRED_FINAL_PROVIDER_PHASE'
      ) {
        throw new Error(
          `ROUTE_ACCEPTANCE_DEFERRED_CONTRACT_INVALID:${route.routeId}:${record.capability_id}`,
        );
      }
    }

    const nonDeferred = routeCapabilities.filter((record) => !record.deferred_final_provider_phase);
    const blocked = nonDeferred.filter((record) => record.closure_state === 'BLOCKED');
    const productionVerified = nonDeferred.filter(
      (record) => record.closure_state === 'PRODUCTION_VERIFIED',
    );
    const unresolved = nonDeferred.filter(
      (record) => record.closure_state !== 'PRODUCTION_VERIFIED',
    );
    const proofState = routeProofState({
      deferredCount: deferred.length,
      nonDeferredCount: nonDeferred.length,
      productionVerifiedCount: productionVerified.length,
      blockedCount: blocked.length,
    });

    return {
      route_id: route.routeId,
      route_name: route.name,
      structural_state: 'PASS' as const,
      proof_state: proofState,
      capability_total: routeCapabilities.length,
      deferred_final_provider_count: deferred.length,
      non_deferred_count: nonDeferred.length,
      non_deferred_production_verified_count: productionVerified.length,
      blocked_non_deferred_count: blocked.length,
      counts_by_closure_state: countClosureStates(routeCapabilities),
      final_provider_capability_ids: deferred.map((record) => record.capability_id).sort(),
      unresolved_non_deferred_capability_ids: unresolved
        .map((record) => record.capability_id)
        .sort(),
      semantic_assertion: [
        route.routeId,
        'structural=PASS',
        `proof=${proofState}`,
        'structural acceptance never implies runtime/provider/production proof',
      ].join(' | '),
      next_action: routeNextAction(proofState),
      exact_head_sha: capabilities.exact_head_sha,
    };
  });

  return {
    exact_head_sha: capabilities.exact_head_sha,
    route_total: records.length,
    records,
    structural_pass_count: records.length,
    production_verified_count: records.filter(
      (record) => record.proof_state === 'PRODUCTION_VERIFIED',
    ).length,
    deferred_final_provider_count: records.filter(
      (record) => record.proof_state === 'DEFERRED_FINAL_PROVIDER_PHASE',
    ).length,
    blocked_count: records.filter((record) => record.proof_state === 'BLOCKED').length,
    not_proven_count: records.filter((record) => record.proof_state === 'NOT_PROVEN').length,
  };
}

function routeProofState(input: {
  readonly deferredCount: number;
  readonly nonDeferredCount: number;
  readonly productionVerifiedCount: number;
  readonly blockedCount: number;
}): RouteProofState {
  if (input.blockedCount > 0) return 'BLOCKED';
  if (input.productionVerifiedCount !== input.nonDeferredCount) return 'NOT_PROVEN';
  if (input.deferredCount > 0) return 'DEFERRED_FINAL_PROVIDER_PHASE';
  return 'PRODUCTION_VERIFIED';
}

function routeNextAction(state: RouteProofState): string {
  if (state === 'PRODUCTION_VERIFIED') return 'NONE';
  if (state === 'DEFERRED_FINAL_PROVIDER_PHASE') return 'FINAL_PROVIDER_PHASE';
  if (state === 'BLOCKED') return 'RECONCILE_BLOCKED_NON_DEFERRED_CAPABILITIES';
  return 'PROVE_NON_DEFERRED_CAPABILITIES';
}

function countClosureStates(
  records: LiveCapabilityMatrix['records'],
): Readonly<Record<CapabilityClosureState, number>> {
  const counts: Record<CapabilityClosureState, number> = {
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
  for (const record of records) counts[record.closure_state] += 1;
  return counts;
}