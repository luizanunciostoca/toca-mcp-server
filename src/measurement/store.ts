import type {
  ConversionReconciliation,
  MeasurementPlan,
  NormalizedMeasurementEvent,
  TicketingEventBinding,
  TicketingInventorySnapshot,
  TicketingSalesSummary,
  TicketingWebhookReceipt,
} from './contracts.js';

export interface MeasurementEventQuery {
  readonly tenantId: string;
  readonly eventId: string;
  readonly from: string;
  readonly to: string;
  readonly eventNames?: readonly string[];
  readonly limit?: number;
}

export interface MeasurementStore {
  createPlan(plan: MeasurementPlan): Promise<MeasurementPlan>;
  getPlan(planId: string): Promise<MeasurementPlan | undefined>;
  recordEvent(event: NormalizedMeasurementEvent): Promise<NormalizedMeasurementEvent>;
  listEvents(query: MeasurementEventQuery): Promise<readonly NormalizedMeasurementEvent[]>;
  bindTicketingEvent(binding: TicketingEventBinding): Promise<TicketingEventBinding>;
  getTicketingBinding(provider: string, externalEventId: string): Promise<TicketingEventBinding | undefined>;
  recordSalesSummary(summary: TicketingSalesSummary): Promise<TicketingSalesSummary>;
  recordInventory(snapshot: TicketingInventorySnapshot): Promise<TicketingInventorySnapshot>;
  recordWebhook(receipt: TicketingWebhookReceipt): Promise<TicketingWebhookReceipt>;
  recordReconciliation(reconciliation: ConversionReconciliation): Promise<ConversionReconciliation>;
  latestSalesSummary(eventId: string): Promise<TicketingSalesSummary | undefined>;
  latestInventory(eventId: string): Promise<TicketingInventorySnapshot | undefined>;
}
