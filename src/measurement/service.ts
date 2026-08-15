import { randomUUID } from 'node:crypto';
import type { AuditSink } from '../core/audit.js';
import { authorizeExecution, type ExecutionIdentity } from '../core/identity.js';
import type { RiskClass } from '../core/tool-registry.js';
import type { EventRecordStore } from '../events/event-record.js';
import type { MeasurementReadAdapter, TicketingReadOnlyAdapter } from './adapters.js';
import {
  assertAttributionUsable,
  calculateAttribution,
  calculateFunnel,
  calculateSalesPacing,
  reconciliationConfidence,
} from './analytics.js';
import {
  type AttributionModel,
  type AttributionResult,
  type AttributionTouchpoint,
  type ConversionReconciliation,
  type EventSalesPacing,
  type FunnelResult,
  type MeasurementPlan,
  type NormalizedMeasurementEvent,
  type TicketingEventBinding,
  type TicketingInventorySnapshot,
  type TicketingSalesSummary,
  type TicketingWebhookReceipt,
} from './contracts.js';
import {
  assertDataQuality,
  normalizeAttributionModel,
  normalizeEvidence,
  normalizeMeasurementEvent,
  nullableText,
  requireText,
  timestamp,
} from './normalization.js';
import type { MeasurementStore } from './store.js';
import {
  normalizeTicketingInventory,
  normalizeTicketingSalesSummary,
  normalizeTicketingWebhook,
} from './ticketing.js';

export interface MeasurementOperationContext {
  readonly identity: ExecutionIdentity;
  readonly executionId: string;
  readonly correlationId: string;
  readonly workflowInstanceId?: string | null;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface MeasurementFoundationServiceOptions {
  readonly audit?: AuditSink;
  readonly createId?: () => string;
}

export class MeasurementFoundationService {
  readonly #audit?: AuditSink;
  readonly #createId: () => string;

  constructor(
    private readonly store: MeasurementStore,
    private readonly eventRecords: EventRecordStore,
    options: MeasurementFoundationServiceOptions = {},
  ) {
    this.#audit = options.audit;
    this.#createId = options.createId ?? randomUUID;
  }

  async createMeasurementPlan(
    context: MeasurementOperationContext,
    input: {
      readonly planId?: string;
      readonly planKey: string;
      readonly eventId?: string | null;
      readonly objective: string;
      readonly attributionModel: AttributionModel;
      readonly conversionEventNames: readonly string[];
      readonly requiredDimensions?: readonly (
        'source' | 'medium' | 'campaign' | 'content' | 'term'
      )[];
    },
  ): Promise<MeasurementPlan> {
    assertAuthorized(context.identity, 'R18', 'measurement.plan.create', 'WRITE_REVERSIBLE');
    assertContextCorrelation(context);
    const principal = context.identity.principal;
    const eventId = nullableText(input.eventId);
    if (eventId) await this.#assertEventRecord(eventId, context.identity);
    const conversionEventNames = [
      ...new Set(
        input.conversionEventNames.map((name) =>
          requireText(name, 'MEASUREMENT_CONVERSION_EVENT_REQUIRED'),
        ),
      ),
    ].sort();
    if (conversionEventNames.length === 0) throw new Error('MEASUREMENT_CONVERSION_EVENT_REQUIRED');
    const requiredDimensions = [
      ...new Set(input.requiredDimensions ?? ['source', 'medium', 'campaign']),
    ].sort();
    const plan: MeasurementPlan = {
      planId: input.planId
        ? requireText(input.planId, 'MEASUREMENT_PLAN_ID_REQUIRED')
        : this.#createId(),
      planKey: requireText(input.planKey, 'MEASUREMENT_PLAN_KEY_REQUIRED'),
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId,
      organizationId: principal.organizationId,
      eventId,
      objective: requireText(input.objective, 'MEASUREMENT_PLAN_OBJECTIVE_REQUIRED'),
      attributionModel: normalizeAttributionModel(input.attributionModel),
      conversionEventNames,
      requiredDimensions,
      createdByPrincipalId: principal.principalId,
      correlationId: context.correlationId,
      workflowInstanceId: nullableText(context.workflowInstanceId),
      evidence: normalizeEvidence(context.evidence),
      createdAt: timestamp(
        context.now ?? new Date().toISOString(),
        'MEASUREMENT_PLAN_CREATED_AT_INVALID',
      ),
    };
    return this.#audited(context, 'measurement.plan.create', 'WRITE_REVERSIBLE', plan.planId, () =>
      this.store.createPlan(plan),
    );
  }

  async ingestProviderMeasurement(
    context: MeasurementOperationContext,
    adapter: MeasurementReadAdapter,
    input: {
      readonly externalPropertyId: string;
      readonly eventId?: string | null;
      readonly from: string;
      readonly to: string;
      readonly eventNames?: readonly string[];
    },
  ): Promise<readonly NormalizedMeasurementEvent[]> {
    assertAuthorized(context.identity, 'R18', 'measurement.event.record', 'WRITE_REVERSIBLE');
    assertContextCorrelation(context);
    const eventId = nullableText(input.eventId);
    if (eventId) await this.#assertEventRecord(eventId, context.identity);
    const events = await adapter.readEvents({
      externalPropertyId: requireText(input.externalPropertyId, 'MEASUREMENT_PROPERTY_ID_REQUIRED'),
      from: timestamp(input.from, 'MEASUREMENT_RANGE_FROM_INVALID'),
      to: timestamp(input.to, 'MEASUREMENT_RANGE_TO_INVALID'),
      eventNames: input.eventNames,
    });
    const results: NormalizedMeasurementEvent[] = [];
    for (const providerEvent of events) {
      if (providerEvent.sourceSystem !== adapter.sourceSystem) {
        throw new Error('MEASUREMENT_ADAPTER_SOURCE_SYSTEM_MISMATCH');
      }
      const normalized = normalizeMeasurementEvent({
        measurementEventId: this.#createId(),
        tenantId: context.identity.principal.tenantId,
        workspaceId: context.identity.principal.workspaceId,
        organizationId: context.identity.principal.organizationId,
        eventId,
        sourceSystem: providerEvent.sourceSystem,
        sourceEventId: providerEvent.sourceEventId,
        eventName: providerEvent.eventName,
        occurredAt: providerEvent.occurredAt,
        ingestedAt: context.now,
        sessionId: providerEvent.sessionId,
        anonymousId: providerEvent.anonymousId,
        subjectId: providerEvent.subjectId,
        source: providerEvent.source,
        medium: providerEvent.medium,
        campaign: providerEvent.campaign,
        content: providerEvent.content,
        term: providerEvent.term,
        campaignId: providerEvent.campaignId,
        contentId: providerEvent.contentId,
        isConversion: providerEvent.isConversion,
        valueMinor: providerEvent.valueMinor,
        currency: providerEvent.currency,
        properties: providerEvent.properties,
        requesterPrincipalId: context.identity.principal.principalId,
        correlationId: context.correlationId,
        workflowInstanceId: context.workflowInstanceId,
        evidence: [...context.evidence, ...providerEvent.evidence, `adapter:${adapter.provider}`],
      });
      assertDataQuality(normalized.dataQuality);
      results.push(
        await this.#audited(
          context,
          'measurement.event.record',
          'WRITE_REVERSIBLE',
          normalized.measurementEventId,
          () => this.store.recordEvent(normalized),
        ),
      );
    }
    return results;
  }

  async bindTicketingEvent(
    context: MeasurementOperationContext,
    adapter: TicketingReadOnlyAdapter,
    input: {
      readonly eventId: string;
      readonly externalEventId: string;
      readonly bindingId?: string;
    },
  ): Promise<TicketingEventBinding> {
    assertAuthorized(context.identity, 'R18', 'ticketing.event.identity.read', 'READ');
    assertAuthorized(context.identity, 'R18', 'measurement.event.record', 'WRITE_REVERSIBLE');
    const event = await this.#assertEventRecord(input.eventId, context.identity);
    const identity = await this.#audited(
      context,
      'ticketing.event.identity.read',
      'READ',
      input.externalEventId,
      () =>
        adapter.resolveEvent(
          requireText(input.externalEventId, 'TICKETING_EXTERNAL_EVENT_ID_REQUIRED'),
        ),
    );
    if (identity.provider !== adapter.provider)
      throw new Error('TICKETING_PROVIDER_IDENTITY_MISMATCH');
    if (identity.externalEventId !== input.externalEventId)
      throw new Error('TICKETING_EXTERNAL_EVENT_ID_MISMATCH');
    const binding: TicketingEventBinding = {
      bindingId: input.bindingId ?? this.#createId(),
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      organizationId: event.organizationId,
      eventId: event.eventId,
      provider: adapter.provider,
      externalEventId: identity.externalEventId,
      externalEventUrl: identity.canonicalUrl,
      requesterPrincipalId: context.identity.principal.principalId,
      correlationId: context.correlationId,
      workflowInstanceId: nullableText(context.workflowInstanceId),
      evidence: normalizeEvidence([...context.evidence, ...identity.evidence]),
      createdAt: timestamp(
        context.now ?? new Date().toISOString(),
        'TICKETING_BINDING_CREATED_AT_INVALID',
      ),
    };
    return this.#audited(
      context,
      'measurement.event.record',
      'WRITE_REVERSIBLE',
      binding.bindingId,
      () => this.store.bindTicketingEvent(binding),
    );
  }

  async readAndRecordTicketingSales(
    context: MeasurementOperationContext,
    adapter: TicketingReadOnlyAdapter,
    input: {
      readonly eventId: string;
      readonly externalEventId: string;
      readonly snapshotId?: string;
    },
  ): Promise<TicketingSalesSummary> {
    assertAuthorized(context.identity, 'R18', 'ticketing.sales.summary.read', 'READ');
    assertAuthorized(context.identity, 'R18', 'measurement.event.record', 'WRITE_REVERSIBLE');
    await this.#assertTicketingBinding(adapter, input.eventId, input.externalEventId);
    const result = await this.#audited(
      context,
      'ticketing.sales.summary.read',
      'READ',
      input.externalEventId,
      () => adapter.readSalesSummary(input.externalEventId),
    );
    const summary = normalizeTicketingSalesSummary({
      snapshotId: input.snapshotId ?? this.#createId(),
      eventId: input.eventId,
      tenantId: context.identity.principal.tenantId,
      workspaceId: context.identity.principal.workspaceId,
      organizationId: context.identity.principal.organizationId,
      provider: adapter.provider,
      externalEventId: input.externalEventId,
      result,
      requesterPrincipalId: context.identity.principal.principalId,
      correlationId: context.correlationId,
      workflowInstanceId: context.workflowInstanceId,
    });
    return this.#audited(
      context,
      'measurement.event.record',
      'WRITE_REVERSIBLE',
      summary.snapshotId,
      () => this.store.recordSalesSummary(summary),
    );
  }

  async readAndRecordTicketingInventory(
    context: MeasurementOperationContext,
    adapter: TicketingReadOnlyAdapter,
    input: {
      readonly eventId: string;
      readonly externalEventId: string;
      readonly snapshotId?: string;
    },
  ): Promise<TicketingInventorySnapshot> {
    assertAuthorized(context.identity, 'R18', 'ticketing.inventory.read', 'READ');
    assertAuthorized(context.identity, 'R18', 'measurement.event.record', 'WRITE_REVERSIBLE');
    await this.#assertTicketingBinding(adapter, input.eventId, input.externalEventId);
    const result = await this.#audited(
      context,
      'ticketing.inventory.read',
      'READ',
      input.externalEventId,
      () => adapter.readInventory(input.externalEventId),
    );
    const snapshot = normalizeTicketingInventory({
      snapshotId: input.snapshotId ?? this.#createId(),
      eventId: input.eventId,
      tenantId: context.identity.principal.tenantId,
      workspaceId: context.identity.principal.workspaceId,
      organizationId: context.identity.principal.organizationId,
      provider: adapter.provider,
      externalEventId: input.externalEventId,
      result,
      requesterPrincipalId: context.identity.principal.principalId,
      correlationId: context.correlationId,
      workflowInstanceId: context.workflowInstanceId,
    });
    return this.#audited(
      context,
      'measurement.event.record',
      'WRITE_REVERSIBLE',
      snapshot.snapshotId,
      () => this.store.recordInventory(snapshot),
    );
  }

  async ingestTicketingWebhook(
    context: MeasurementOperationContext,
    input: Parameters<typeof normalizeTicketingWebhook>[0],
  ): Promise<TicketingWebhookReceipt> {
    assertAuthorized(context.identity, 'R18', 'ticketing.webhook.record', 'WRITE_REVERSIBLE');
    await this.#assertEventRecord(input.eventId, context.identity);
    const receipt = normalizeTicketingWebhook({
      ...input,
      tenantId: context.identity.principal.tenantId,
      workspaceId: context.identity.principal.workspaceId,
      organizationId: context.identity.principal.organizationId,
      requesterPrincipalId: context.identity.principal.principalId,
      correlationId: context.correlationId,
      workflowInstanceId: context.workflowInstanceId,
      evidence: [...context.evidence, ...input.evidence],
    });
    assertDataQuality(receipt.dataQuality);
    return this.#audited(
      context,
      'ticketing.webhook.record',
      'WRITE_REVERSIBLE',
      receipt.receiptId,
      () => this.store.recordWebhook(receipt),
    );
  }

  async reconcileConversions(
    context: MeasurementOperationContext,
    input: {
      readonly reconciliationId?: string;
      readonly eventId: string;
      readonly windowStartsAt: string;
      readonly windowEndsAt: string;
      readonly measuredConversions: number;
      readonly ticketConversions: number;
      readonly matchedConversions: number;
      readonly measuredRevenueMinor?: number | null;
      readonly ticketRevenueMinor?: number | null;
      readonly currency?: string | null;
      readonly sourceQualityScore: number;
    },
  ): Promise<ConversionReconciliation> {
    assertAuthorized(context.identity, 'R31', 'ticketing.conversion.reconcile', 'WRITE_REVERSIBLE');
    await this.#assertEventRecord(input.eventId, context.identity);
    const confidence = reconciliationConfidence(input);
    const value: ConversionReconciliation = {
      reconciliationId: input.reconciliationId ?? this.#createId(),
      tenantId: context.identity.principal.tenantId,
      workspaceId: context.identity.principal.workspaceId,
      organizationId: context.identity.principal.organizationId,
      eventId: input.eventId,
      windowStartsAt: timestamp(input.windowStartsAt, 'RECONCILIATION_WINDOW_START_INVALID'),
      windowEndsAt: timestamp(input.windowEndsAt, 'RECONCILIATION_WINDOW_END_INVALID'),
      measuredConversions: input.measuredConversions,
      ticketConversions: input.ticketConversions,
      matchedConversions: input.matchedConversions,
      unmatchedMeasurements: input.measuredConversions - input.matchedConversions,
      unmatchedTickets: input.ticketConversions - input.matchedConversions,
      measuredRevenueMinor: input.measuredRevenueMinor ?? null,
      ticketRevenueMinor: input.ticketRevenueMinor ?? null,
      currency: nullableText(input.currency)?.toUpperCase() ?? null,
      confidence,
      requesterPrincipalId: context.identity.principal.principalId,
      correlationId: context.correlationId,
      workflowInstanceId: nullableText(context.workflowInstanceId),
      evidence: normalizeEvidence(context.evidence),
      createdAt: timestamp(
        context.now ?? new Date().toISOString(),
        'RECONCILIATION_CREATED_AT_INVALID',
      ),
    };
    if (Date.parse(value.windowEndsAt) <= Date.parse(value.windowStartsAt))
      throw new Error('RECONCILIATION_WINDOW_INVALID');
    return this.#audited(
      context,
      'ticketing.conversion.reconcile',
      'WRITE_REVERSIBLE',
      value.reconciliationId,
      () => this.store.recordReconciliation(value),
    );
  }

  calculateFunnel(
    identity: ExecutionIdentity,
    stages: Parameters<typeof calculateFunnel>[0],
  ): FunnelResult {
    assertAuthorized(identity, 'R31', 'performance.funnel.calculate', 'READ');
    return calculateFunnel(stages);
  }

  calculateAttribution(
    identity: ExecutionIdentity,
    input: {
      readonly model: AttributionModel;
      readonly touchpoints: readonly AttributionTouchpoint[];
      readonly conversionOccurredAt: string;
      readonly sourceQualityScore: number;
      readonly identityContinuityScore: number;
      readonly reconciliationScore: number;
      readonly requireUsableConfidence?: boolean;
    },
  ): AttributionResult {
    assertAuthorized(identity, 'R31', 'performance.attribution.calculate', 'READ');
    const result = calculateAttribution(input);
    if (input.requireUsableConfidence ?? true) assertAttributionUsable(result.confidence);
    return result;
  }

  async calculateEventSalesPacing(
    identity: ExecutionIdentity,
    input: {
      readonly eventId: string;
      readonly salesStartedAt: string;
      readonly asOf: string;
      readonly dataQualityScore: number;
    },
  ): Promise<EventSalesPacing> {
    assertAuthorized(identity, 'R31', 'performance.event.sales_pacing.calculate', 'READ');
    const event = await this.#assertEventRecord(input.eventId, identity);
    const [sales, inventory] = await Promise.all([
      this.store.latestSalesSummary(event.eventId),
      this.store.latestInventory(event.eventId),
    ]);
    if (!sales) throw new Error('EVENT_SALES_SNAPSHOT_REQUIRED');
    return calculateSalesPacing({
      event,
      salesStartedAt: input.salesStartedAt,
      asOf: input.asOf,
      sold: sales.soldCount,
      capacity: inventory?.capacity ?? null,
      dataQualityScore: input.dataQualityScore,
    });
  }

  async #assertEventRecord(eventId: string, identity: ExecutionIdentity) {
    const event = await this.eventRecords.get(requireText(eventId, 'EVENT_RECORD_ID_REQUIRED'));
    if (!event) throw new Error('EVENT_RECORD_NOT_FOUND');
    const principal = identity.principal;
    if (
      event.tenantId !== principal.tenantId ||
      event.workspaceId !== principal.workspaceId ||
      event.organizationId !== principal.organizationId
    ) {
      throw new Error('EVENT_RECORD_SCOPE_MISMATCH');
    }
    return event;
  }

  async #assertTicketingBinding(
    adapter: TicketingReadOnlyAdapter,
    eventId: string,
    externalEventId: string,
  ): Promise<void> {
    const binding = await this.store.getTicketingBinding(adapter.provider, externalEventId);
    if (!binding) throw new Error('TICKETING_EVENT_BINDING_REQUIRED');
    if (binding.eventId !== eventId) throw new Error('TICKETING_EVENT_BINDING_MISMATCH');
  }

  async #audited<T>(
    context: MeasurementOperationContext,
    capabilityId: string,
    riskClass: RiskClass,
    externalResourceId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    if (!this.#audit) return action();
    const base = auditBase(context, capabilityId, externalResourceId);
    await this.#audit.write({ ...base, status: 'STARTED', createdAt: nowIso(context.now) });
    try {
      const value = await action();
      await this.#audit.write({ ...base, status: 'SUCCEEDED', createdAt: nowIso() });
      return value;
    } catch (error) {
      await this.#audit.write({
        ...base,
        status: 'FAILED',
        errorCode: error instanceof Error ? error.message.split(':')[0] : 'UNKNOWN_ERROR',
        evidence: [...context.evidence, `risk-class:${riskClass}`],
        createdAt: nowIso(),
      });
      throw error;
    }
  }
}

function assertAuthorized(
  identity: ExecutionIdentity,
  routeId: 'R18' | 'R31',
  capabilityId: string,
  riskClass: RiskClass,
): void {
  const decision = authorizeExecution(identity, { routeId, capabilityId, riskClass });
  if (!decision.allowed) throw new Error(decision.reason);
}

function assertContextCorrelation(context: MeasurementOperationContext): void {
  requireText(context.executionId, 'MEASUREMENT_EXECUTION_ID_REQUIRED');
  requireText(context.correlationId, 'MEASUREMENT_CORRELATION_ID_REQUIRED');
  normalizeEvidence(context.evidence);
}

function auditBase(
  context: MeasurementOperationContext,
  toolName: string,
  externalResourceId: string,
) {
  const principal = context.identity.principal;
  return {
    executionId: context.executionId,
    correlationId: context.correlationId,
    toolName,
    requester: principal.principalId,
    principalType: principal.principalType,
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    organizationId: principal.organizationId,
    ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
    authenticationMethod: principal.authenticationMethod,
    authorizationRoles: context.identity.authorization.roles,
    externalResourceId,
    evidence: normalizeEvidence(context.evidence),
  } as const;
}

function nowIso(value?: string): string {
  return timestamp(value ?? new Date().toISOString(), 'MEASUREMENT_AUDIT_TIMESTAMP_INVALID');
}
