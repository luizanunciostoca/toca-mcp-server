import type { ToolDefinition } from '../core/tool-registry.js';
import type { ProviderCapabilityValidationEvidence } from './capability-validation-evidence.js';
import type { CapabilityDefinition } from './types.js';

export type CapabilityClosureState =
  | 'DOCUMENTED'
  | 'IMPLEMENTED'
  | 'INTEGRATED'
  | 'RUNTIME_BOUND'
  | 'PROVIDER_VERIFIED'
  | 'PRODUCTION_VERIFIED'
  | 'BLOCKED'
  | 'DEFERRED'
  | 'NOT_PROVEN';

export type CapabilityEvidenceFreshness = 'CURRENT' | 'EXPIRED' | 'FUTURE' | 'NONE';

export interface LiveCapabilityMatrixRecord {
  readonly capability_id: string;
  readonly route_id: CapabilityDefinition['primary_route_id'];
  readonly owner: string;
  readonly source_lifecycle_status: CapabilityDefinition['lifecycle_status'];
  readonly closure_state: CapabilityClosureState;
  readonly execution_surface: CapabilityDefinition['execution_surface'];
  readonly runtime_registered: boolean;
  readonly runtime_identity: string | null;
  readonly provider_identity: string;
  readonly provider_resource_id: string | null;
  readonly evidence_exact_head_sha: string | null;
  readonly evidence_freshness: CapabilityEvidenceFreshness;
  readonly semantic_assertion: string;
  readonly readback: string;
  readonly blocker: string | null;
  readonly next_action: string;
  readonly deferred_final_provider_phase: boolean;
  readonly exact_head_sha: string;
}

export interface LiveCapabilityMatrix {
  readonly exact_head_sha: string;
  readonly generated_at: string;
  readonly runtime_identity: string | null;
  readonly total: number;
  readonly records: readonly LiveCapabilityMatrixRecord[];
  readonly counts_by_state: Readonly<Record<CapabilityClosureState, number>>;
}

export interface BuildLiveCapabilityMatrixOptions {
  readonly exactHeadSha: string;
  readonly now?: string;
  readonly runtimeIdentity?: string | null;
  readonly observedRuntimeTools?: readonly ToolDefinition[];
  readonly providerEvidence?: readonly ProviderCapabilityValidationEvidence[];
}

const DEFERRED_FINAL_PREFIXES = ['google_ads.', 'whatsapp.', 'email.'] as const;

export function buildLiveCapabilityMatrix(
  definitions: readonly CapabilityDefinition[],
  options: BuildLiveCapabilityMatrixOptions,
): LiveCapabilityMatrix {
  assertSha(options.exactHeadSha);
  const now = options.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error('LIVE_CAPABILITY_MATRIX_NOW_INVALID');

  const runtimeNames = new Set((options.observedRuntimeTools ?? []).map((tool) => tool.name));
  const evidenceByCapability = new Map(
    (options.providerEvidence ?? []).map((evidence) => [evidence.capabilityId, evidence] as const),
  );
  const records = definitions
    .map((definition) =>
      projectCapability(definition, {
        exactHeadSha: options.exactHeadSha,
        now,
        runtimeIdentity: options.runtimeIdentity ?? null,
        runtimeRegistered: runtimeNames.has(definition.capability_id),
        providerEvidence: evidenceByCapability.get(definition.capability_id),
      }),
    )
    .sort((left, right) => left.capability_id.localeCompare(right.capability_id));

  const ids = new Set(records.map((record) => record.capability_id));
  if (ids.size !== records.length) throw new Error('LIVE_CAPABILITY_MATRIX_DUPLICATE_CAPABILITY');

  return {
    exact_head_sha: options.exactHeadSha,
    generated_at: now,
    runtime_identity: options.runtimeIdentity ?? null,
    total: records.length,
    records,
    counts_by_state: countStates(records),
  };
}

function projectCapability(
  definition: CapabilityDefinition,
  context: {
    readonly exactHeadSha: string;
    readonly now: string;
    readonly runtimeIdentity: string | null;
    readonly runtimeRegistered: boolean;
    readonly providerEvidence?: ProviderCapabilityValidationEvidence;
  },
): LiveCapabilityMatrixRecord {
  const deferred = DEFERRED_FINAL_PREFIXES.some((prefix) =>
    definition.capability_id.startsWith(prefix),
  );
  const freshness = evidenceFreshness(context.providerEvidence, context.now);
  const currentEvidence = freshness === 'CURRENT' ? context.providerEvidence : undefined;
  const closureState = resolveClosureState(definition, {
    deferred,
    runtimeRegistered: context.runtimeRegistered,
    runtimeIdentity: context.runtimeIdentity,
    providerEvidenceCurrent: Boolean(currentEvidence),
  });
  const blocker = resolveBlocker(definition, {
    closureState,
    deferred,
    runtimeRegistered: context.runtimeRegistered,
    runtimeIdentity: context.runtimeIdentity,
    freshness,
  });

  return {
    capability_id: definition.capability_id,
    route_id: definition.primary_route_id,
    owner: definition.owner,
    source_lifecycle_status: definition.lifecycle_status,
    closure_state: closureState,
    execution_surface: definition.execution_surface,
    runtime_registered: context.runtimeRegistered,
    runtime_identity: context.runtimeIdentity,
    provider_identity: definition.provider,
    provider_resource_id: currentEvidence?.externalResourceId ?? null,
    evidence_exact_head_sha: currentEvidence?.exactHeadSha ?? null,
    evidence_freshness: freshness,
    semantic_assertion: semanticAssertion(definition, closureState),
    readback: resolveReadback(
      currentEvidence,
      context.runtimeRegistered,
      context.runtimeIdentity,
    ),
    blocker,
    next_action: resolveNextAction(closureState, blocker),
    deferred_final_provider_phase: deferred,
    exact_head_sha: context.exactHeadSha,
  };
}

function resolveClosureState(
  definition: CapabilityDefinition,
  proof: {
    readonly deferred: boolean;
    readonly runtimeRegistered: boolean;
    readonly runtimeIdentity: string | null;
    readonly providerEvidenceCurrent: boolean;
  },
): CapabilityClosureState {
  if (proof.deferred) return 'DEFERRED';
  if (
    definition.lifecycle_status === 'BLOCKED' ||
    definition.lifecycle_status === 'DISABLED' ||
    definition.lifecycle_status === 'SUSPENDED' ||
    definition.lifecycle_status === 'DEGRADED'
  ) {
    return 'BLOCKED';
  }
  if (
    proof.providerEvidenceCurrent &&
    proof.runtimeRegistered &&
    proof.runtimeIdentity &&
    definition.lifecycle_status === 'PRODUCTION_VALIDATED'
  ) {
    return 'PRODUCTION_VERIFIED';
  }
  if (proof.providerEvidenceCurrent) return 'PROVIDER_VERIFIED';
  if (proof.runtimeRegistered && proof.runtimeIdentity) return 'RUNTIME_BOUND';
  if (proof.runtimeRegistered) return 'INTEGRATED';
  if (definition.lifecycle_status === 'PLANNED' || definition.lifecycle_status === 'SPECIFIED') {
    return 'DOCUMENTED';
  }
  if (
    definition.lifecycle_status === 'CONNECTED' ||
    definition.lifecycle_status === 'INTEGRATION_VALIDATED'
  ) {
    return 'NOT_PROVEN';
  }
  if (definition.lifecycle_status === 'PRODUCTION_VALIDATED') return 'NOT_PROVEN';
  return 'IMPLEMENTED';
}

function evidenceFreshness(
  evidence: ProviderCapabilityValidationEvidence | undefined,
  now: string,
): CapabilityEvidenceFreshness {
  if (!evidence) return 'NONE';
  const current = Date.parse(now);
  const validated = Date.parse(evidence.validatedAt);
  const expires = Date.parse(evidence.expiresAt);
  if (validated > current) return 'FUTURE';
  if (expires <= current) return 'EXPIRED';
  return 'CURRENT';
}

function resolveBlocker(
  definition: CapabilityDefinition,
  input: {
    readonly closureState: CapabilityClosureState;
    readonly deferred: boolean;
    readonly runtimeRegistered: boolean;
    readonly runtimeIdentity: string | null;
    readonly freshness: CapabilityEvidenceFreshness;
  },
): string | null {
  if (input.deferred) return 'DEFERRED_FINAL_PROVIDER_PHASE';
  if (input.freshness === 'EXPIRED') return 'EXPIRED_PROVIDER_EVIDENCE';
  if (input.freshness === 'FUTURE') return 'FUTURE_PROVIDER_EVIDENCE';
  if (input.closureState === 'PRODUCTION_VERIFIED') return null;
  if (
    definition.lifecycle_status === 'PRODUCTION_VALIDATED' &&
    input.freshness !== 'CURRENT'
  ) {
    return 'ACTIVE_PRODUCTION_EVIDENCE_REQUIRED';
  }
  if (input.runtimeRegistered && !input.runtimeIdentity) return 'RUNTIME_IDENTITY_NOT_BOUND';
  if (
    definition.execution_surface === 'CATALOG_ONLY' &&
    definition.lifecycle_status !== 'IMPLEMENTED'
  ) {
    return 'IMPLEMENTATION_REQUIRED';
  }
  if (definition.side_effects && input.closureState !== 'PROVIDER_VERIFIED') {
    return 'PROVIDER_VERIFICATION_REQUIRED';
  }
  return null;
}

function resolveReadback(
  evidence: ProviderCapabilityValidationEvidence | undefined,
  runtimeRegistered: boolean,
  runtimeIdentity: string | null,
): string {
  if (evidence) return 'PROVIDER_READBACK_VERIFIED';
  if (runtimeRegistered && runtimeIdentity) return 'RUNTIME_REGISTRY_OBSERVED';
  if (runtimeRegistered) return 'RUNTIME_REGISTRY_OBSERVED_IDENTITY_UNBOUND';
  return 'NOT_PROVEN';
}

function resolveNextAction(state: CapabilityClosureState, blocker: string | null): string {
  if (state === 'PRODUCTION_VERIFIED') return 'NONE';
  if (state === 'DEFERRED') return 'FINAL_PROVIDER_PHASE';
  if (blocker === 'IMPLEMENTATION_REQUIRED') return 'IMPLEMENT_OR_RECONCILE_SOURCE';
  if (blocker === 'RUNTIME_IDENTITY_NOT_BOUND') return 'OBSERVE_AUTHORITATIVE_RUNTIME_IDENTITY';
  if (blocker === 'ACTIVE_PRODUCTION_EVIDENCE_REQUIRED') return 'REVALIDATE_PRODUCTION_EVIDENCE';
  if (blocker === 'PROVIDER_VERIFICATION_REQUIRED') return 'PROVIDER_READBACK_AND_EVIDENCE';
  if (blocker) return 'RECONCILE_BLOCKER';
  if (state === 'IMPLEMENTED') return 'PROVE_INTEGRATION';
  if (state === 'INTEGRATED') return 'BIND_AUTHORITATIVE_RUNTIME_IDENTITY';
  if (state === 'RUNTIME_BOUND') return 'PROVE_PROVIDER_IF_APPLICABLE';
  if (state === 'PROVIDER_VERIFIED') return 'BIND_RUNTIME_AND_PRODUCTION_ACCEPTANCE';
  if (state === 'DOCUMENTED') return 'IMPLEMENT_OR_CONFIRM_DEFERRED_SCOPE';
  return 'PROVE_CURRENT_STATE';
}

function semanticAssertion(
  definition: CapabilityDefinition,
  state: CapabilityClosureState,
): string {
  return [
    definition.capability_id,
    `source=${definition.lifecycle_status}`,
    `surface=${definition.execution_surface}`,
    `closure=${state}`,
    'closure never exceeds observed runtime/provider proof',
  ].join(' | ');
}

function countStates(
  records: readonly LiveCapabilityMatrixRecord[],
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

function assertSha(value: string): void {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('LIVE_CAPABILITY_MATRIX_SHA_INVALID');
}
