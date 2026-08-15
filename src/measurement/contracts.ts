export const MEASUREMENT_SOURCE_SYSTEMS = [
  'GA4',
  'SEARCH_CONSOLE',
  'META',
  'TICKETING',
  'CUSTOM',
] as const;
export type MeasurementSourceSystem = (typeof MEASUREMENT_SOURCE_SYSTEMS)[number];

export const ATTRIBUTION_MODELS = ['FIRST_TOUCH', 'LAST_TOUCH', 'LINEAR'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

export const ATTRIBUTION_CONFIDENCE_LEVELS = ['UNUSABLE', 'LOW', 'MEDIUM', 'HIGH'] as const;
export type AttributionConfidenceLevel = (typeof ATTRIBUTION_CONFIDENCE_LEVELS)[number];

export type MeasurementPrimitive = string | number | boolean | null;
export type MeasurementProperties = Readonly<Record<string, MeasurementPrimitive>>;

export interface MeasurementScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

export interface UtmDimensions {
  readonly source: string | null;
  readonly medium: string | null;
  readonly campaign: string | null;
  readonly content: string | null;
  readonly term: string | null;
}

export interface MeasurementPlan extends MeasurementScope {
  readonly planId: string;
  readonly planKey: string;
  readonly eventId: string | null;
  readonly objective: string;
  readonly attributionModel: AttributionModel;
  readonly conversionEventNames: readonly string[];
  readonly requiredDimensions: readonly (keyof UtmDimensions)[];
  readonly createdByPrincipalId: string;
  readonly correlationId: string;
  readonly workflowInstanceId: string | null;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface DataQualityIssue {
  readonly code: string;
  readonly severity: 'ERROR' | 'WARNING';
  readonly field: string | null;
  readonly message: string;
}

export interface DataQualityReport {
  readonly valid: boolean;
  readonly score: number;
  readonly issues: readonly DataQualityIssue[];
}

export interface NormalizedMeasurementEvent extends MeasurementScope {
  readonly measurementEventId: string;
  readonly eventId: string | null;
  readonly sourceSystem: MeasurementSourceSystem;
  readonly sourceEventId: string;
  readonly eventName: string;
  readonly occurredAt: string;
  readonly ingestedAt: string;
  readonly sessionId: string | null;
  readonly anonymousId: string | null;
  readonly subjectId: string | null;
  readonly utm: UtmDimensions;
  readonly campaignId: string | null;
  readonly contentId: string | null;
  readonly isConversion: boolean;
  readonly valueMinor: number | null;
  readonly currency: string | null;
  readonly properties: MeasurementProperties;
  readonly dataQuality: DataQualityReport;
  readonly requesterPrincipalId: string;
  readonly correlationId: string;
  readonly workflowInstanceId: string | null;
  readonly evidence: readonly string[];
}

export interface TicketingEventBinding extends MeasurementScope {
  readonly bindingId: string;
  readonly eventId: string;
  readonly provider: string;
  readonly externalEventId: string;
  readonly externalEventUrl: string | null;
  readonly requesterPrincipalId: string;
  readonly correlationId: string;
  readonly workflowInstanceId: string | null;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface TicketingSalesSummary extends MeasurementScope {
  readonly snapshotId: string;
  readonly eventId: string;
  readonly provider: string;
  readonly externalEventId: string;
  readonly soldCount: number;
  readonly orderCount: number;
  readonly grossRevenueMinor: number;
  readonly netRevenueMinor: number | null;
  readonly currency: string;
  readonly asOf: string;
  readonly requesterPrincipalId: string;
  readonly correlationId: string;
  readonly workflowInstanceId: string | null;
  readonly evidence: readonly string[];
}

export interface TicketingInventorySnapshot extends MeasurementScope {
  readonly snapshotId: string;
  readonly eventId: string;
  readonly provider: string;
  readonly externalEventId: string;
  readonly capacity: number | null;
  readonly sold: number;
  readonly available: number | null;
  readonly held: number | null;
  readonly asOf: string;
  readonly requesterPrincipalId: string;
  readonly correlationId: string;
  readonly workflowInstanceId: string | null;
  readonly evidence: readonly string[];
}

export interface TicketingWebhookReceipt extends MeasurementScope {
  readonly receiptId: string;
  readonly eventId: string;
  readonly provider: string;
  readonly externalEventId: string;
  readonly providerDeliveryId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly payloadHash: string;
  readonly normalizedPayload: MeasurementProperties;
  readonly dataQuality: DataQualityReport;
  readonly requesterPrincipalId: string;
  readonly correlationId: string;
  readonly workflowInstanceId: string | null;
  readonly evidence: readonly string[];
}

export interface ConversionReconciliation extends MeasurementScope {
  readonly reconciliationId: string;
  readonly eventId: string;
  readonly windowStartsAt: string;
  readonly windowEndsAt: string;
  readonly measuredConversions: number;
  readonly ticketConversions: number;
  readonly matchedConversions: number;
  readonly unmatchedMeasurements: number;
  readonly unmatchedTickets: number;
  readonly measuredRevenueMinor: number | null;
  readonly ticketRevenueMinor: number | null;
  readonly currency: string | null;
  readonly confidence: AttributionConfidence;
  readonly requesterPrincipalId: string;
  readonly correlationId: string;
  readonly workflowInstanceId: string | null;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface FunnelStage {
  readonly name: string;
  readonly count: number;
}

export interface FunnelResult {
  readonly stages: readonly FunnelStage[];
  readonly conversionRate: number | null;
  readonly dropOffs: readonly {
    readonly from: string;
    readonly to: string;
    readonly count: number;
    readonly rate: number | null;
  }[];
  readonly dataQuality: DataQualityReport;
}

export interface AttributionTouchpoint {
  readonly touchpointId: string;
  readonly occurredAt: string;
  readonly source: string | null;
  readonly medium: string | null;
  readonly campaign: string | null;
  readonly content: string | null;
  readonly term: string | null;
  readonly campaignId: string | null;
  readonly contentId: string | null;
}

export interface AttributionCredit extends AttributionTouchpoint {
  readonly credit: number;
}

export interface AttributionConfidence {
  readonly score: number;
  readonly level: AttributionConfidenceLevel;
  readonly reasons: readonly string[];
}

export interface AttributionResult {
  readonly model: AttributionModel;
  readonly credits: readonly AttributionCredit[];
  readonly confidence: AttributionConfidence;
}

export interface EventSalesPacing {
  readonly eventId: string;
  readonly asOf: string;
  readonly sold: number;
  readonly capacity: number | null;
  readonly sellThroughRate: number | null;
  readonly elapsedSalesWindowRatio: number;
  readonly paceRatio: number | null;
  readonly ticketsPerDay: number;
  readonly projectedSelloutAt: string | null;
  readonly confidence: AttributionConfidence;
}

export interface MeasurementCapabilityContract {
  readonly capabilityId: string;
  readonly routeId: 'R18' | 'R31';
  readonly riskClass: 'READ' | 'WRITE_REVERSIBLE';
  readonly providerBoundary: 'INTERNAL' | 'PROVIDER_READ_ONLY_ADAPTER';
  readonly lifecycleStatus: 'IMPLEMENTED';
  readonly sideEffects: boolean;
  readonly providerWritesAllowed: false;
  readonly requiresEventRecord: boolean;
  readonly description: string;
}

export const MEASUREMENT_CAPABILITY_CONTRACTS: readonly MeasurementCapabilityContract[] = [
  capability('measurement.plan.create', 'R18', 'WRITE_REVERSIBLE', 'INTERNAL', false, 'Persist a governed measurement plan.'),
  capability('measurement.plan.validate', 'R18', 'READ', 'INTERNAL', false, 'Validate a measurement plan contract.'),
  capability('tracking.utm.normalize', 'R18', 'READ', 'INTERNAL', false, 'Normalize UTM/source/medium/campaign/content/term dimensions.'),
  capability('measurement.event.normalize', 'R18', 'READ', 'INTERNAL', false, 'Normalize provider measurement events into the canonical schema.'),
  capability('measurement.event.record', 'R18', 'WRITE_REVERSIBLE', 'INTERNAL', false, 'Persist an append-only normalized measurement event.'),
  capability('measurement.data_quality.validate', 'R18', 'READ', 'INTERNAL', false, 'Validate lineage, timestamps and attribution dimensions.'),
  capability('ticketing.event.identity.read', 'R18', 'READ', 'PROVIDER_READ_ONLY_ADAPTER', true, 'Resolve provider ticketing event identity and bind it to EventRecord.'),
  capability('ticketing.sales.summary.read', 'R18', 'READ', 'PROVIDER_READ_ONLY_ADAPTER', true, 'Read and normalize ticketing sales summary.'),
  capability('ticketing.inventory.read', 'R18', 'READ', 'PROVIDER_READ_ONLY_ADAPTER', true, 'Read and normalize ticket inventory.'),
  capability('ticketing.webhook.record', 'R18', 'WRITE_REVERSIBLE', 'INTERNAL', true, 'Record normalized provider webhook delivery without provider mutation.'),
  capability('ticketing.conversion.reconcile', 'R31', 'WRITE_REVERSIBLE', 'INTERNAL', true, 'Persist measurement-to-ticket conversion reconciliation.'),
  capability('performance.funnel.calculate', 'R31', 'READ', 'INTERNAL', false, 'Calculate visit-to-checkout-to-ticket funnel.'),
  capability('performance.funnel.dropoff.calculate', 'R31', 'READ', 'INTERNAL', false, 'Calculate stage drop-off.'),
  capability('performance.attribution.calculate', 'R31', 'READ', 'INTERNAL', false, 'Allocate conversion credit across touchpoints.'),
  capability('performance.attribution.confidence.calculate', 'R31', 'READ', 'INTERNAL', false, 'Calculate attribution confidence from source quality and identity continuity.'),
  capability('performance.event.sales_pacing.calculate', 'R31', 'READ', 'INTERNAL', true, 'Calculate event ticket sales pacing against EventRecord timing.'),
] as const;

function capability(
  capabilityId: string,
  routeId: 'R18' | 'R31',
  riskClass: 'READ' | 'WRITE_REVERSIBLE',
  providerBoundary: 'INTERNAL' | 'PROVIDER_READ_ONLY_ADAPTER',
  requiresEventRecord: boolean,
  description: string,
): MeasurementCapabilityContract {
  return {
    capabilityId,
    routeId,
    riskClass,
    providerBoundary,
    lifecycleStatus: 'IMPLEMENTED',
    sideEffects: riskClass !== 'READ',
    providerWritesAllowed: false,
    requiresEventRecord,
    description,
  };
}
