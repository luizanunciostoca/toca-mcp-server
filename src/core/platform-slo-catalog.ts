export const PLATFORM_SLO_KINDS = ['RATIO', 'LATENCY_SECONDS', 'LAG_SECONDS', 'BACKLOG'] as const;
export type PlatformSloKind = (typeof PLATFORM_SLO_KINDS)[number];

export const PLATFORM_SLO_COMPARATORS = ['GTE', 'LTE'] as const;
export type PlatformSloComparator = (typeof PLATFORM_SLO_COMPARATORS)[number];

export const PLATFORM_SLO_SEVERITIES = ['P0', 'P1', 'P2'] as const;
export type PlatformSloSeverity = (typeof PLATFORM_SLO_SEVERITIES)[number];

export const PLATFORM_SLO_IDS = [
  'publication_success',
  'workflow_success',
  'provider_readback_success',
  'lead_ingestion_success',
  'first_response_latency',
  'webhook_success',
  'outbox_lag',
  'retry_exhaustion',
  'dead_letter_backlog',
  'crm_write_success',
  'attribution_write_success',
  'whatsapp_delivery_success',
  'email_delivery_success',
  'r31_feedback_loop_success',
] as const;

export type PlatformSloId = (typeof PLATFORM_SLO_IDS)[number];

export interface PlatformSloDefinition {
  readonly id: PlatformSloId;
  readonly routeId: 'R25' | 'R31';
  readonly signal: string;
  readonly kind: PlatformSloKind;
  readonly comparator: PlatformSloComparator;
  readonly target: number;
  readonly windowMinutes: number;
  readonly severity: PlatformSloSeverity;
  readonly futureProvider: boolean;
  readonly runbook: string;
}

export const PLATFORM_NEXT_SLOS: readonly PlatformSloDefinition[] = Object.freeze([
  {
    id: 'publication_success',
    routeId: 'R25',
    signal: 'publication.verified_terminal_success_ratio',
    kind: 'RATIO',
    comparator: 'GTE',
    target: 0.995,
    windowMinutes: 60,
    severity: 'P1',
    futureProvider: false,
    runbook: 'docs/operations/observability-incident-runbook.md#publication',
  },
  {
    id: 'workflow_success',
    routeId: 'R25',
    signal: 'workflow.terminal_success_ratio',
    kind: 'RATIO',
    comparator: 'GTE',
    target: 0.995,
    windowMinutes: 60,
    severity: 'P1',
    futureProvider: false,
    runbook: 'docs/operations/observability-incident-runbook.md#workflow',
  },
  {
    id: 'provider_readback_success',
    routeId: 'R25',
    signal: 'provider.readback_verified_ratio',
    kind: 'RATIO',
    comparator: 'GTE',
    target: 1,
    windowMinutes: 60,
    severity: 'P0',
    futureProvider: false,
    runbook: 'docs/operations/observability-incident-runbook.md#provider-readback',
  },
  {
    id: 'lead_ingestion_success',
    routeId: 'R25',
    signal: 'lead.ingestion_success_ratio',
    kind: 'RATIO',
    comparator: 'GTE',
    target: 0.995,
    windowMinutes: 60,
    severity: 'P1',
    futureProvider: false,
    runbook: 'docs/operations/observability-incident-runbook.md#lead-ingestion',
  },
  {
    id: 'first_response_latency',
    routeId: 'R25',
    signal: 'lead.first_response_p95_seconds',
    kind: 'LATENCY_SECONDS',
    comparator: 'LTE',
    target: 300,
    windowMinutes: 60,
    severity: 'P1',
    futureProvider: false,
    runbook: 'docs/operations/observability-incident-runbook.md#first-response',
  },
  {
    id: 'webhook_success',
    routeId: 'R25',
    signal: 'webhook.accepted_success_ratio',
    kind: 'RATIO',
    comparator: 'GTE',
    target: 0.999,
    windowMinutes: 60,
    severity: 'P1',
    futureProvider: false,
    runbook: 'docs/operations/observability-incident-runbook.md#webhook',
  },
  {
    id: 'outbox_lag',
    routeId: 'R25',
    signal: 'outbox.oldest_pending_age_seconds',
    kind: 'LAG_SECONDS',
    comparator: 'LTE',
    target: 300,
    windowMinutes: 15,
    severity: 'P1',
    futureProvider: false,
    runbook: 'docs/operations/observability-incident-runbook.md#outbox',
  },
  {
    id: 'retry_exhaustion',
    routeId: 'R25',
    signal: 'retry.exhausted_count',
    kind: 'BACKLOG',
    comparator: 'LTE',
    target: 0,
    windowMinutes: 15,
    severity: 'P1',
    futureProvider: false,
    runbook: 'docs/operations/observability-incident-runbook.md#retry-and-dead-letter',
  },
  {
    id: 'dead_letter_backlog',
    routeId: 'R25',
    signal: 'dead_letter.pending_count',
    kind: 'BACKLOG',
    comparator: 'LTE',
    target: 0,
    windowMinutes: 15,
    severity: 'P1',
    futureProvider: false,
    runbook: 'docs/operations/observability-incident-runbook.md#retry-and-dead-letter',
  },
  {
    id: 'crm_write_success',
    routeId: 'R25',
    signal: 'crm.durable_write_success_ratio',
    kind: 'RATIO',
    comparator: 'GTE',
    target: 0.999,
    windowMinutes: 60,
    severity: 'P1',
    futureProvider: false,
    runbook: 'docs/operations/observability-incident-runbook.md#crm',
  },
  {
    id: 'attribution_write_success',
    routeId: 'R25',
    signal: 'attribution.durable_write_success_ratio',
    kind: 'RATIO',
    comparator: 'GTE',
    target: 0.999,
    windowMinutes: 60,
    severity: 'P1',
    futureProvider: false,
    runbook: 'docs/operations/observability-incident-runbook.md#attribution',
  },
  {
    id: 'whatsapp_delivery_success',
    routeId: 'R25',
    signal: 'whatsapp.delivery_verified_ratio',
    kind: 'RATIO',
    comparator: 'GTE',
    target: 0.99,
    windowMinutes: 60,
    severity: 'P1',
    futureProvider: true,
    runbook: 'docs/operations/observability-incident-runbook.md#future-providers',
  },
  {
    id: 'email_delivery_success',
    routeId: 'R25',
    signal: 'email.delivery_verified_ratio',
    kind: 'RATIO',
    comparator: 'GTE',
    target: 0.99,
    windowMinutes: 60,
    severity: 'P1',
    futureProvider: true,
    runbook: 'docs/operations/observability-incident-runbook.md#future-providers',
  },
  {
    id: 'r31_feedback_loop_success',
    routeId: 'R31',
    signal: 'r31.feedback_loop_success_ratio',
    kind: 'RATIO',
    comparator: 'GTE',
    target: 0.99,
    windowMinutes: 1440,
    severity: 'P2',
    futureProvider: false,
    runbook: 'docs/operations/observability-incident-runbook.md#r31',
  },
]);

export function validatePlatformSloCatalog(
  definitions: readonly PlatformSloDefinition[] = PLATFORM_NEXT_SLOS,
): void {
  const ids = new Set<PlatformSloId>();

  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`PLATFORM_SLO_DUPLICATE:${definition.id}`);
    ids.add(definition.id);

    if (!PLATFORM_SLO_KINDS.includes(definition.kind))
      throw new Error(`PLATFORM_SLO_KIND_INVALID:${definition.id}`);
    if (!PLATFORM_SLO_COMPARATORS.includes(definition.comparator))
      throw new Error(`PLATFORM_SLO_COMPARATOR_INVALID:${definition.id}`);
    if (!PLATFORM_SLO_SEVERITIES.includes(definition.severity))
      throw new Error(`PLATFORM_SLO_SEVERITY_INVALID:${definition.id}`);
    if (!Number.isFinite(definition.target) || definition.target < 0)
      throw new Error(`PLATFORM_SLO_TARGET_INVALID:${definition.id}`);
    if (!Number.isSafeInteger(definition.windowMinutes) || definition.windowMinutes < 1)
      throw new Error(`PLATFORM_SLO_WINDOW_INVALID:${definition.id}`);
    if (definition.kind === 'RATIO' && definition.target > 1)
      throw new Error(`PLATFORM_SLO_RATIO_TARGET_INVALID:${definition.id}`);
    if (!definition.signal.trim()) throw new Error(`PLATFORM_SLO_SIGNAL_REQUIRED:${definition.id}`);
    if (!definition.runbook.trim()) throw new Error(`PLATFORM_SLO_RUNBOOK_REQUIRED:${definition.id}`);
  }

  for (const requiredId of PLATFORM_SLO_IDS) {
    if (!ids.has(requiredId)) throw new Error(`PLATFORM_SLO_REQUIRED_MISSING:${requiredId}`);
  }
}

export function getPlatformSlo(id: PlatformSloId): PlatformSloDefinition {
  const definition = PLATFORM_NEXT_SLOS.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`PLATFORM_SLO_UNKNOWN:${id}`);
  return definition;
}
