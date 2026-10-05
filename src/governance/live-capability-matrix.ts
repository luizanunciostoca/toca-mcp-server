import type { CapabilityStatus, ToolDefinition } from '../core/tool-registry.js';
import {
  validateProviderCapabilityEvidence,
  type ProviderCapabilityValidationEvidence,
} from './capability-validation-evidence.js';
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

export type CapabilityEvidenceFreshness = 'CURRENT' | 'EXPIRED' | 'FUTURE' | 'INVALID' | 'NONE';

export interface LiveCapabilityMatrixRecord {
  readonly capability_id: string;
  readonly route_id: CapabilityDefinition['primary_route_id'];
  readonly owner: string;
  readonly source_lifecycle_status: CapabilityDefinition['lifecycle_status'];
  readonly closure_state: CapabilityClosureState;
  readonly execution_surface: CapabilityDefinition['execution_surface'];
  readonly runtime_registered: boolean;
  readonly runtime_status: CapabilityStatus | null;
  readonly runtime_provider: string | null;
  readonly runtime_metadata_aligned: boolean;
  readonly runtime_binding_observed: boolean;
  readonly runtime_eligible: boolean;
  readonly runtime_identity: string | null;
  readonly provider_identity: string;
  readonly provider_resource_id: string | null;
  readonly evidence_exact_head_sha: string | null;
  readonly evidence_freshness: CapabilityEvidenceFreshness;
  readonly evidence_validation_error: string | null;
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
  readonly observedRuntimeBindingIds?: readonly string[];
  readonly providerEvidence?: readonly ProviderCapabilityValidationEvidence[];
}

interface RuntimeAssessment {
  readonly registered: boolean;
  readonly tool: ToolDefinition | undefined;
  readonly metadataAligned: boolean;
  readonly statusEligible: boolean;
  readonly bindingObserved: boolean;
  readonly eligible: boolean;
}

interface EvidenceAssessment {
  readonly raw: ProviderCapabilityValidationEvidence | undefined;
  readonly current: ProviderCapabilityValidationEvidence | undefined;
  readonly freshness: CapabilityEvidenceFreshness;
  readonly validationError: string | null;
}

const DEFERRED_FINAL_PREFIXES = ['google_ads.', 'whatsapp.', 'email.'] as const;
const RUNTIME_INELIGIBLE_STATUSES: ReadonlySet<CapabilityStatus> = new Set([
  'PLANNED',
  'SPECIFIED',
  'DEGRADED',
  'DISABLED',
  'BLOCKED',
  'SUSPENDED',
  'DEPRECATED',
  'RETIRED',
  'REMOVED',
]);

export function buildLiveCapabilityMatrix(
  definitions: readonly CapabilityDefinition[],
  options: BuildLiveCapabilityMatrixOptions,
): LiveCapabilityMatrix {
  assertSha(options.exactHeadSha);
  const now = options.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error('LIVE_CAPABILITY_MATRIX_NOW_INVALID');

  const definitionIds = new Set(definitions.map((definition) => definition.capability_id));
  if (definitionIds.size !== definitions.length) {
    throw new Error('LIVE_CAPABILITY_MATRIX_DUPLICATE_CAPABILITY');
  }

  const runtimeByCapability = indexRuntimeTools(options.observedRuntimeTools ?? []);
  const runtimeBindingIds = new Set(options.observedRuntimeBindingIds ?? []);
  const evidenceByCapability = indexRawEvidence(options.providerEvidence ?? [], definitionIds);

  const records = definitions
    .map((definition) => {
      const runtime = assessRuntime(
        definition,
        runtimeByCapability.get(definition.capability_id),
        runtimeBindingIds.has(definition.capability_id),
      );
      const evidence = assessEvidence(
        definition,
        evidenceByCapability.get(definition.capability_id),
        options.exactHeadSha,
        now,
      );
      return projectCapability(definition, {
        exactHeadSha: options.exactHeadSha,
        runtimeIdentity: options.runtimeIdentity ?? null,
        runtime,
        evidence,
      });
    })
    .sort((left, right) => left.capability_id.localeCompare(right.capability_id));

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
    readonly runtimeIdentity: string | null;
    readonly runtime: RuntimeAssessment;
    readonly evidence: EvidenceAssessment;
  },
): LiveCapabilityMatrixRecord {
  const deferred = DEFERRED_FINAL_PREFIXES.some((prefix) =>
    definition.capability_id.startsWith(prefix),
  );
  const closureState = resolveClosureState(definition, {
    deferred,
    runtime: context.runtime,
    runtimeIdentity: context.runtimeIdentity,
    providerEvidenceCurrent: Boolean(context.evidence.current),
  });
  const blocker = resolveBlocker(definition, {
    closureState,
    deferred,
    runtime: context.runtime,
    runtimeIdentity: context.runtimeIdentity,
    evidence: context.evidence,
  });

  return {
    capability_id: definition.capability_id,
    route_id: definition.primary_route_id,
    owner: definition.owner,
    source_lifecycle_status: definition.lifecycle_status,
    closure_state: closureState,
    execution_surface: definition.execution_surface,
    runtime_registered: context.runtime.registered,
    runtime_status: context.runtime.tool?.capabilityStatus ?? null,
    runtime_provider: context.runtime.tool?.provider ?? null,
    runtime_metadata_aligned: context.runtime.metadataAligned,
    runtime_binding_observed: context.runtime.bindingObserved,
    runtime_eligible: context.runtime.eligible,
    runtime_identity: context.runtimeIdentity,
    provider_identity: definition.provider,
    provider_resource_id: context.evidence.raw?.externalResourceId ?? null,
    evidence_exact_head_sha: context.evidence.raw?.exactHeadSha ?? null,
    evidence_freshness: context.evidence.freshness,
    evidence_validation_error: context.evidence.validationError,
    semantic_assertion: semanticAssertion(definition, closureState),
    readback: resolveReadback(context.evidence, context.runtime, context.runtimeIdentity),
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
    readonly runtime: RuntimeAssessment;
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
    proof.runtime.eligible &&
    proof.runtimeIdentity &&
    definition.lifecycle_status === 'PRODUCTION_VALIDATED'
  ) {
    return 'PRODUCTION_VERIFIED';
  }
  if (proof.providerEvidenceCurrent) return 'PROVIDER_VERIFIED';
  if (proof.runtime.eligible && proof.runtimeIdentity) return 'RUNTIME_BOUND';
  if (proof.runtime.registered && proof.runtime.metadataAligned && proof.runtime.statusEligible) {
    return 'INTEGRATED';
  }
  if (definition.lifecycle_status === 'PLANNED' || definition.lifecycle_status === 'SPECIFIED') {
    return 'DOCUMENTED';
  }
  if (
    definition.lifecycle_status === 'CONNECTED' ||
    definition.lifecycle_status === 'INTEGRATION_VALIDATED' ||
    definition.lifecycle_status === 'PRODUCTION_VALIDATED'
  ) {
    return 'NOT_PROVEN';
  }
  return 'IMPLEMENTED';
}

function assessRuntime(
  definition: CapabilityDefinition,
  tool: ToolDefinition | undefined,
  bindingObserved: boolean,
): RuntimeAssessment {
  if (!tool) {
    return {
      registered: false,
      tool: undefined,
      metadataAligned: false,
      statusEligible: false,
      bindingObserved: false,
      eligible: false,
    };
  }

  const metadataAligned =
    tool.provider === definition.provider &&
    tool.riskClass === definition.risk_class &&
    tool.sideEffects === definition.side_effects &&
    tool.capabilityStatus === definition.lifecycle_status &&
    tool.idempotent === definition.idempotent;
  const statusEligible =
    !RUNTIME_INELIGIBLE_STATUSES.has(tool.capabilityStatus) &&
    (!tool.sideEffects || tool.capabilityStatus === 'PRODUCTION_VALIDATED');
  const eligible = metadataAligned && statusEligible && bindingObserved;

  return {
    registered: true,
    tool,
    metadataAligned,
    statusEligible,
    bindingObserved,
    eligible,
  };
}

function assessEvidence(
  definition: CapabilityDefinition,
  evidence: ProviderCapabilityValidationEvidence | undefined,
  exactHeadSha: string,
  now: string,
): EvidenceAssessment {
  if (!evidence) {
    return {
      raw: undefined,
      current: undefined,
      freshness: 'NONE',
      validationError: null,
    };
  }

  const freshness = evidenceFreshness(evidence, now);
  try {
    const current = validateProviderCapabilityEvidence(evidence, {
      capabilityId: definition.capability_id,
      provider: definition.provider,
      exactHeadSha,
      now,
    });
    return { raw: evidence, current, freshness: 'CURRENT', validationError: null };
  } catch (error) {
    return {
      raw: evidence,
      current: undefined,
      freshness,
      validationError: errorCode(error),
    };
  }
}

function evidenceFreshness(
  evidence: ProviderCapabilityValidationEvidence,
  now: string,
): CapabilityEvidenceFreshness {
  const current = Date.parse(now);
  const validated = Date.parse(evidence.validatedAt);
  const expires = Date.parse(evidence.expiresAt);
  if (!Number.isFinite(validated) || !Number.isFinite(expires)) return 'INVALID';
  if (validated > current) return 'FUTURE';
  if (expires <= current) return 'EXPIRED';
  return 'CURRENT';
}

function resolveBlocker(
  definition: CapabilityDefinition,
  input: {
    readonly closureState: CapabilityClosureState;
    readonly deferred: boolean;
    readonly runtime: RuntimeAssessment;
    readonly runtimeIdentity: string | null;
    readonly evidence: EvidenceAssessment;
  },
): string | null {
  if (input.deferred) return 'DEFERRED_FINAL_PROVIDER_PHASE';
  if (input.evidence.validationError) {
    if (input.evidence.freshness === 'EXPIRED') return 'EXPIRED_PROVIDER_EVIDENCE';
    if (input.evidence.freshness === 'FUTURE') return 'FUTURE_PROVIDER_EVIDENCE';
    return `INVALID_PROVIDER_EVIDENCE:${input.evidence.validationError}`;
  }
  if (input.closureState === 'PRODUCTION_VERIFIED') return null;
  if (definition.lifecycle_status === 'PRODUCTION_VALIDATED' && !input.evidence.current) {
    return 'ACTIVE_PRODUCTION_EVIDENCE_REQUIRED';
  }
  if (input.runtime.registered && !input.runtime.metadataAligned) {
    return 'RUNTIME_METADATA_MISMATCH';
  }
  if (input.runtime.registered && !input.runtime.statusEligible) {
    return 'RUNTIME_STATUS_NOT_ELIGIBLE';
  }
  if (
    input.runtime.registered &&
    input.runtime.metadataAligned &&
    input.runtime.statusEligible &&
    !input.runtime.bindingObserved
  ) {
    return 'RUNTIME_BINDING_NOT_OBSERVED';
  }
  if (input.runtime.eligible && !input.runtimeIdentity) return 'RUNTIME_IDENTITY_NOT_BOUND';
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
  evidence: EvidenceAssessment,
  runtime: RuntimeAssessment,
  runtimeIdentity: string | null,
): string {
  if (evidence.current) return 'PROVIDER_READBACK_VERIFIED';
  if (runtime.eligible && runtimeIdentity) return 'RUNTIME_BINDING_OBSERVED';
  if (runtime.registered && runtime.metadataAligned) return 'RUNTIME_REGISTRY_OBSERVED';
  return 'NOT_PROVEN';
}

function resolveNextAction(state: CapabilityClosureState, blocker: string | null): string {
  if (state === 'PRODUCTION_VERIFIED') return 'NONE';
  if (state === 'DEFERRED') return 'FINAL_PROVIDER_PHASE';
  if (blocker === 'IMPLEMENTATION_REQUIRED') return 'IMPLEMENT_OR_RECONCILE_SOURCE';
  if (blocker === 'RUNTIME_METADATA_MISMATCH') return 'RECONCILE_RUNTIME_METADATA';
  if (blocker === 'RUNTIME_STATUS_NOT_ELIGIBLE') return 'KEEP_RUNTIME_FAIL_CLOSED';
  if (blocker === 'RUNTIME_BINDING_NOT_OBSERVED') return 'OBSERVE_RUNTIME_BINDING';
  if (blocker === 'RUNTIME_IDENTITY_NOT_BOUND') return 'OBSERVE_AUTHORITATIVE_RUNTIME_IDENTITY';
  if (blocker === 'ACTIVE_PRODUCTION_EVIDENCE_REQUIRED') return 'REVALIDATE_PRODUCTION_EVIDENCE';
  if (blocker === 'PROVIDER_VERIFICATION_REQUIRED') return 'PROVIDER_READBACK_AND_EVIDENCE';
  if (blocker) return 'RECONCILE_BLOCKER';
  if (state === 'IMPLEMENTED') return 'PROVE_INTEGRATION';
  if (state === 'INTEGRATED') return 'PROVE_RUNTIME_BINDING';
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

function indexRuntimeTools(tools: readonly ToolDefinition[]): ReadonlyMap<string, ToolDefinition> {
  const map = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    if (map.has(tool.name))
      throw new Error(`LIVE_CAPABILITY_MATRIX_DUPLICATE_RUNTIME_TOOL:${tool.name}`);
    map.set(tool.name, tool);
  }
  return map;
}

function indexRawEvidence(
  values: readonly ProviderCapabilityValidationEvidence[],
  definitionIds: ReadonlySet<string>,
): ReadonlyMap<string, ProviderCapabilityValidationEvidence> {
  const map = new Map<string, ProviderCapabilityValidationEvidence>();
  for (const evidence of values) {
    if (!definitionIds.has(evidence.capabilityId)) {
      throw new Error(
        `LIVE_CAPABILITY_MATRIX_EVIDENCE_CAPABILITY_UNKNOWN:${evidence.capabilityId}`,
      );
    }
    if (map.has(evidence.capabilityId)) {
      throw new Error(`LIVE_CAPABILITY_MATRIX_DUPLICATE_EVIDENCE:${evidence.capabilityId}`);
    }
    map.set(evidence.capabilityId, evidence);
  }
  return map;
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

function errorCode(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'UNKNOWN_EVIDENCE_VALIDATION_ERROR';
}

function assertSha(value: string): void {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('LIVE_CAPABILITY_MATRIX_SHA_INVALID');
}
