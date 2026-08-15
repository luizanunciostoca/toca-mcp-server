import type {
  TicketingInventorySnapshot,
  TicketingSalesSummary,
  TicketingWebhookReceipt,
} from './contracts.js';
import type { TicketingInventoryReadResult, TicketingSalesReadResult } from './adapters.js';
import {
  nonNegativeInteger,
  normalizeCurrency,
  normalizeEvidence,
  nullableNonNegativeInteger,
  nullableText,
  payloadSha256,
  requireText,
  timestamp,
  validateMeasurementDataQuality,
} from './normalization.js';

export function normalizeTicketingSalesSummary(input: {
  readonly snapshotId: string;
  readonly eventId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly provider: string;
  readonly externalEventId: string;
  readonly result: TicketingSalesReadResult;
  readonly requesterPrincipalId: string;
  readonly correlationId: string;
  readonly workflowInstanceId?: string | null | undefined;
}): TicketingSalesSummary {
  const grossRevenueMinor = nonNegativeInteger(
    input.result.grossRevenueMinor,
    'TICKETING_GROSS_REVENUE_INVALID',
  );
  const netRevenueMinor = nullableNonNegativeInteger(
    input.result.netRevenueMinor,
    'TICKETING_NET_REVENUE_INVALID',
  );
  if (netRevenueMinor !== null && netRevenueMinor > grossRevenueMinor) {
    throw new Error('TICKETING_NET_REVENUE_EXCEEDS_GROSS');
  }
  return {
    snapshotId: requireText(input.snapshotId, 'TICKETING_SNAPSHOT_ID_REQUIRED'),
    eventId: requireText(input.eventId, 'TICKETING_EVENT_RECORD_ID_REQUIRED'),
    tenantId: requireText(input.tenantId, 'MEASUREMENT_TENANT_ID_REQUIRED'),
    workspaceId: requireText(input.workspaceId, 'MEASUREMENT_WORKSPACE_ID_REQUIRED'),
    organizationId: requireText(input.organizationId, 'MEASUREMENT_ORGANIZATION_ID_REQUIRED'),
    provider: requireText(input.provider, 'TICKETING_PROVIDER_REQUIRED'),
    externalEventId: requireText(input.externalEventId, 'TICKETING_EXTERNAL_EVENT_ID_REQUIRED'),
    soldCount: nonNegativeInteger(input.result.soldCount, 'TICKETING_SOLD_COUNT_INVALID'),
    orderCount: nonNegativeInteger(input.result.orderCount, 'TICKETING_ORDER_COUNT_INVALID'),
    grossRevenueMinor,
    netRevenueMinor,
    currency: normalizeCurrency(input.result.currency, true) ?? fail('TICKETING_CURRENCY_REQUIRED'),
    asOf: timestamp(input.result.asOf, 'TICKETING_AS_OF_INVALID'),
    requesterPrincipalId: requireText(input.requesterPrincipalId, 'MEASUREMENT_REQUESTER_REQUIRED'),
    correlationId: requireText(input.correlationId, 'MEASUREMENT_CORRELATION_ID_REQUIRED'),
    workflowInstanceId: nullableText(input.workflowInstanceId),
    evidence: normalizeEvidence(input.result.evidence),
  };
}

export function normalizeTicketingInventory(input: {
  readonly snapshotId: string;
  readonly eventId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly provider: string;
  readonly externalEventId: string;
  readonly result: TicketingInventoryReadResult;
  readonly requesterPrincipalId: string;
  readonly correlationId: string;
  readonly workflowInstanceId?: string | null | undefined;
}): TicketingInventorySnapshot {
  const capacity = nullableNonNegativeInteger(input.result.capacity, 'TICKETING_CAPACITY_INVALID');
  const sold = nonNegativeInteger(input.result.sold, 'TICKETING_SOLD_INVALID');
  const available = nullableNonNegativeInteger(
    input.result.available,
    'TICKETING_AVAILABLE_INVALID',
  );
  const held = nullableNonNegativeInteger(input.result.held, 'TICKETING_HELD_INVALID');
  if (capacity !== null && sold > capacity) throw new Error('TICKETING_SOLD_EXCEEDS_CAPACITY');
  if (capacity !== null && available !== null && sold + available > capacity) {
    throw new Error('TICKETING_INVENTORY_EXCEEDS_CAPACITY');
  }
  return {
    snapshotId: requireText(input.snapshotId, 'TICKETING_SNAPSHOT_ID_REQUIRED'),
    eventId: requireText(input.eventId, 'TICKETING_EVENT_RECORD_ID_REQUIRED'),
    tenantId: requireText(input.tenantId, 'MEASUREMENT_TENANT_ID_REQUIRED'),
    workspaceId: requireText(input.workspaceId, 'MEASUREMENT_WORKSPACE_ID_REQUIRED'),
    organizationId: requireText(input.organizationId, 'MEASUREMENT_ORGANIZATION_ID_REQUIRED'),
    provider: requireText(input.provider, 'TICKETING_PROVIDER_REQUIRED'),
    externalEventId: requireText(input.externalEventId, 'TICKETING_EXTERNAL_EVENT_ID_REQUIRED'),
    capacity,
    sold,
    available,
    held,
    asOf: timestamp(input.result.asOf, 'TICKETING_AS_OF_INVALID'),
    requesterPrincipalId: requireText(input.requesterPrincipalId, 'MEASUREMENT_REQUESTER_REQUIRED'),
    correlationId: requireText(input.correlationId, 'MEASUREMENT_CORRELATION_ID_REQUIRED'),
    workflowInstanceId: nullableText(input.workflowInstanceId),
    evidence: normalizeEvidence(input.result.evidence),
  };
}

export function normalizeTicketingWebhook(input: {
  readonly receiptId: string;
  readonly eventId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly provider: string;
  readonly externalEventId: string;
  readonly providerDeliveryId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly receivedAt?: string;
  readonly rawPayload: unknown;
  readonly normalizedPayload: Readonly<Record<string, string | number | boolean | null>>;
  readonly requesterPrincipalId: string;
  readonly correlationId: string;
  readonly workflowInstanceId?: string | null | undefined;
  readonly evidence: readonly string[];
}): TicketingWebhookReceipt {
  const receivedAt = timestamp(
    input.receivedAt ?? new Date().toISOString(),
    'TICKETING_WEBHOOK_RECEIVED_AT_INVALID',
  );
  const occurredAt = timestamp(input.occurredAt, 'TICKETING_WEBHOOK_OCCURRED_AT_INVALID');
  const evidence = normalizeEvidence(input.evidence);
  const dataQuality = validateMeasurementDataQuality({
    sourceSystem: 'TICKETING',
    eventId: requireText(input.eventId, 'TICKETING_EVENT_RECORD_ID_REQUIRED'),
    occurredAt,
    ingestedAt: receivedAt,
    sourceEventId: requireText(input.providerDeliveryId, 'TICKETING_DELIVERY_ID_REQUIRED'),
    utm: { source: null, medium: null, campaign: null, content: null, term: null },
    isConversion: /ticket|order|sale|purchase/i.test(input.eventType),
    valueMinor: null,
    currency: null,
    evidence,
  });
  return {
    receiptId: requireText(input.receiptId, 'TICKETING_RECEIPT_ID_REQUIRED'),
    eventId: input.eventId.trim(),
    tenantId: requireText(input.tenantId, 'MEASUREMENT_TENANT_ID_REQUIRED'),
    workspaceId: requireText(input.workspaceId, 'MEASUREMENT_WORKSPACE_ID_REQUIRED'),
    organizationId: requireText(input.organizationId, 'MEASUREMENT_ORGANIZATION_ID_REQUIRED'),
    provider: requireText(input.provider, 'TICKETING_PROVIDER_REQUIRED'),
    externalEventId: requireText(input.externalEventId, 'TICKETING_EXTERNAL_EVENT_ID_REQUIRED'),
    providerDeliveryId: input.providerDeliveryId.trim(),
    eventType: requireText(input.eventType, 'TICKETING_WEBHOOK_EVENT_TYPE_REQUIRED'),
    occurredAt,
    receivedAt,
    payloadHash: payloadSha256(input.rawPayload),
    normalizedPayload: input.normalizedPayload,
    dataQuality,
    requesterPrincipalId: requireText(input.requesterPrincipalId, 'MEASUREMENT_REQUESTER_REQUIRED'),
    correlationId: requireText(input.correlationId, 'MEASUREMENT_CORRELATION_ID_REQUIRED'),
    workflowInstanceId: nullableText(input.workflowInstanceId),
    evidence,
  };
}

function fail(code: string): never {
  throw new Error(code);
}
