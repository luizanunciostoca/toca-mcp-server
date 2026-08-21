import type { RevenueEvidenceSource } from './attribution-revenue-contracts.js';
import type {
  MeasurementProperties,
  MeasurementSourceSystem,
  TicketingInventorySnapshot,
  TicketingSalesSummary,
} from './contracts.js';

export interface ProviderMeasurementEvent {
  readonly provider: string;
  readonly sourceSystem: Exclude<MeasurementSourceSystem, 'TICKETING' | 'CUSTOM'>;
  readonly sourceEventId: string;
  readonly eventName: string;
  readonly occurredAt: string;
  readonly sessionId?: string | null;
  readonly anonymousId?: string | null;
  readonly subjectId?: string | null;
  readonly source?: string | null;
  readonly medium?: string | null;
  readonly campaign?: string | null;
  readonly content?: string | null;
  readonly term?: string | null;
  readonly campaignId?: string | null;
  readonly contentId?: string | null;
  readonly isConversion?: boolean;
  readonly valueMinor?: number | null;
  readonly currency?: string | null;
  readonly properties?: MeasurementProperties;
  readonly evidence: readonly string[];
}

export interface MeasurementReadRequest {
  readonly externalPropertyId: string;
  readonly from: string;
  readonly to: string;
  readonly eventNames?: readonly string[] | undefined;
}

/**
 * Domain-facing measurement adapter. Implementations may use GA4, Search Console
 * or Meta, but the domain never imports provider SDKs or transport contracts.
 */
export interface MeasurementReadAdapter {
  readonly provider: string;
  readonly sourceSystem: Exclude<MeasurementSourceSystem, 'TICKETING' | 'CUSTOM'>;
  readEvents(request: MeasurementReadRequest): Promise<readonly ProviderMeasurementEvent[]>;
}

export interface TicketingExternalEventIdentity {
  readonly provider: string;
  readonly externalEventId: string;
  readonly canonicalUrl: string | null;
  readonly evidence: readonly string[];
}

export interface TicketingSalesReadResult {
  readonly soldCount: number;
  readonly orderCount: number;
  readonly grossRevenueMinor: number;
  readonly netRevenueMinor: number | null;
  readonly currency: string;
  readonly asOf: string;
  readonly evidence: readonly string[];
}

export interface TicketingInventoryReadResult {
  readonly capacity: number | null;
  readonly sold: number;
  readonly available: number | null;
  readonly held: number | null;
  readonly asOf: string;
  readonly evidence: readonly string[];
}

/**
 * Intentionally read-only. There are no payment, refund, transfer, ticket issue,
 * inventory mutation, event mutation or financial-write methods on this boundary.
 */
export interface TicketingReadOnlyAdapter {
  readonly provider: string;
  resolveEvent(externalEventId: string): Promise<TicketingExternalEventIdentity>;
  readSalesSummary(externalEventId: string): Promise<TicketingSalesReadResult>;
  readInventory(externalEventId: string): Promise<TicketingInventoryReadResult>;
}

export const COMMERCE_PROVIDER_STATUSES = [
  'PENDING',
  'PAID',
  'CANCELED',
  'REFUNDED',
  'CHARGEBACK',
] as const;
export type CommerceProviderStatus = (typeof COMMERCE_PROVIDER_STATUSES)[number];

export interface CommerceProviderCustomerIdentity {
  readonly providerCustomerId: string | null;
  readonly email: string | null;
  readonly phone: string | null;
}

export interface CommerceProviderAttributionContext {
  readonly contactId: string | null;
  readonly leadId: string | null;
  readonly opportunityId: string | null;
  readonly conversationId: string | null;
  readonly eventId: string | null;
  readonly source: string | null;
  readonly campaign: string | null;
  readonly ad: string | null;
  readonly content: string | null;
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  readonly utmCampaign: string | null;
  readonly utmContent: string | null;
  readonly utmTerm: string | null;
}

export interface CommerceProviderWebhookEnvelope {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly receivedAt: string;
}

export interface CommerceWebhookVerification {
  readonly verified: boolean;
  readonly providerDeliveryId: string;
  readonly evidence: readonly string[];
}

export interface CommerceProviderEvent {
  readonly provider: string;
  readonly providerDeliveryId: string;
  readonly providerEventId: string;
  readonly source: RevenueEvidenceSource;
  readonly externalReference: string;
  readonly providerStatus: string;
  readonly status: CommerceProviderStatus;
  readonly occurredAt: string;
  readonly customer: CommerceProviderCustomerIdentity;
  readonly attribution: CommerceProviderAttributionContext;
  readonly ticketReference: string | null;
  readonly orderReference: string | null;
  readonly paymentReference: string | null;
  readonly checkoutReference: string | null;
  readonly evidence: readonly string[];
}

export interface CommerceProviderReadback extends CommerceProviderEvent {
  readonly providerEvidenceRef: string;
  readonly providerReadbackAt: string;
  readonly currency: string | null;
  readonly grossRevenueMinor: number | null;
  readonly netRevenueMinor: number | null;
  readonly refundMinor: number | null;
  readonly costMinor: number | null;
}

/**
 * Provider-neutral commerce boundary for ticket/order/checkout/payment confirmation.
 * Implementations must verify the webhook signature and then perform provider readback;
 * the webhook payload itself is never sufficient revenue evidence.
 *
 * This interface contains no provider writes and does not process money. It exists beside
 * TicketingReadOnlyAdapter so ticketing providers can implement both contracts without a
 * second Measurement/Attribution domain.
 */
export interface CommerceProviderReadbackAdapter {
  readonly provider: string;
  verifyWebhookSignature(
    envelope: CommerceProviderWebhookEnvelope,
  ): Promise<CommerceWebhookVerification>;
  parseWebhook(
    envelope: CommerceProviderWebhookEnvelope,
    verification: CommerceWebhookVerification,
  ): Promise<CommerceProviderEvent>;
  readback(event: CommerceProviderEvent): Promise<CommerceProviderReadback>;
}

export interface TicketingReadNormalizer {
  normalizeSales(input: {
    readonly snapshotId: string;
    readonly eventId: string;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
    readonly externalEventId: string;
    readonly result: TicketingSalesReadResult;
    readonly requesterPrincipalId: string;
    readonly correlationId: string;
    readonly workflowInstanceId?: string | null;
  }): TicketingSalesSummary;
  normalizeInventory(input: {
    readonly snapshotId: string;
    readonly eventId: string;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
    readonly externalEventId: string;
    readonly result: TicketingInventoryReadResult;
    readonly requesterPrincipalId: string;
    readonly correlationId: string;
    readonly workflowInstanceId?: string | null;
  }): TicketingInventorySnapshot;
}

export type Ga4ReadAdapter = MeasurementReadAdapter;
export type SearchConsoleReadAdapter = MeasurementReadAdapter;
export type MetaMeasurementReadAdapter = MeasurementReadAdapter;
