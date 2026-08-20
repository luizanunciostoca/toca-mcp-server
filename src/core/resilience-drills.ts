export const CONTROLLED_DRILL_SCENARIOS = [
  'restart',
  'worker_crash',
  'duplicate_webhook',
  'delayed_callback',
  'provider_outage',
  'partial_provider_write',
  'ambiguous_status',
  'expired_token',
  'quota_exceeded',
] as const;

export type ControlledDrillScenario = (typeof CONTROLLED_DRILL_SCENARIOS)[number];

export interface ControlledDrillDefinition {
  readonly scenario: ControlledDrillScenario;
  readonly requiresProviderReadback: boolean;
  readonly destructiveProviderMutationAllowed: false;
  readonly expectedInvariants: readonly string[];
}

export interface ControlledDrillObservation {
  readonly scenario: ControlledDrillScenario;
  readonly duplicateExternalWrite: boolean;
  readonly providerReadbackPerformed: boolean;
  readonly durableAuditRecorded: boolean;
  readonly outboxStatePreserved: boolean;
  readonly idempotencyPreserved: boolean;
  readonly cleanupVerified: boolean;
}

export interface ControlledDrillAssessment {
  readonly scenario: ControlledDrillScenario;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export const CONTROLLED_DRILL_CATALOG: readonly ControlledDrillDefinition[] = Object.freeze([
  define('restart', false, [
    'durable workflow state survives process restart',
    'idempotency identity survives restart',
    'pending Outbox work is resumed without duplicate side effect',
  ]),
  define('worker_crash', false, [
    'claimed work is recoverable through bounded retry semantics',
    'dead-letter transition remains durable when retries are exhausted',
    'no duplicate provider mutation is emitted',
  ]),
  define('duplicate_webhook', false, [
    'webhook idempotency collapses duplicate delivery',
    'only one durable business transition is accepted',
    'duplicate receipt remains auditable',
  ]),
  define('delayed_callback', true, [
    'late provider truth is reconciled against the durable execution identity',
    'terminal state is not guessed before callback/readback reconciliation',
    'Outbox and Audit records preserve the ordering evidence',
  ]),
  define('provider_outage', true, [
    'provider failure remains retryable or explicitly blocked',
    'no success is reported without provider truth',
    'bounded retry does not bypass approval or idempotency',
  ]),
  define('partial_provider_write', true, [
    'ambiguous mutation is reconciled before retry',
    'provider readback decides whether a retry is safe',
    'duplicate external mutation is forbidden',
  ]),
  define('ambiguous_status', true, [
    'ambiguous local status never becomes verified success',
    'provider truth is read before state repair',
    'manual escalation remains available when truth is unresolved',
  ]),
  define('expired_token', true, [
    'authentication failure does not trigger alternate credential bypass',
    'secret reference may rotate without committing secret material',
    'recovery resumes only after provider authentication readback',
  ]),
  define('quota_exceeded', true, [
    'quota failure is classified without blind high-frequency retry',
    'retry respects provider retry-after or bounded policy',
    'durable state remains replayable after quota recovery',
  ]),
]);

export function getControlledDrillDefinition(
  scenario: ControlledDrillScenario,
): ControlledDrillDefinition {
  const definition = CONTROLLED_DRILL_CATALOG.find((candidate) => candidate.scenario === scenario);
  if (!definition) throw new Error(`CONTROLLED_DRILL_UNKNOWN:${scenario}`);
  return definition;
}

export function assessControlledDrill(
  observation: ControlledDrillObservation,
): ControlledDrillAssessment {
  const definition = getControlledDrillDefinition(observation.scenario);
  const failures: string[] = [];

  if (observation.duplicateExternalWrite) failures.push('DUPLICATE_EXTERNAL_WRITE');
  if (!observation.durableAuditRecorded) failures.push('AUDIT_EVIDENCE_MISSING');
  if (!observation.outboxStatePreserved) failures.push('OUTBOX_STATE_NOT_PRESERVED');
  if (!observation.idempotencyPreserved) failures.push('IDEMPOTENCY_NOT_PRESERVED');
  if (!observation.cleanupVerified) failures.push('CONTROLLED_CLEANUP_UNVERIFIED');
  if (definition.requiresProviderReadback && !observation.providerReadbackPerformed)
    failures.push('PROVIDER_READBACK_REQUIRED');

  return {
    scenario: observation.scenario,
    passed: failures.length === 0,
    failures,
  };
}

function define(
  scenario: ControlledDrillScenario,
  requiresProviderReadback: boolean,
  expectedInvariants: readonly string[],
): ControlledDrillDefinition {
  return Object.freeze({
    scenario,
    requiresProviderReadback,
    destructiveProviderMutationAllowed: false,
    expectedInvariants: Object.freeze([...expectedInvariants]),
  });
}
