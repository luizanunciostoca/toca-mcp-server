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
