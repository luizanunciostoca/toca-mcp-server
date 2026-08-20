import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';
import type {
  AttributionTouchpointRecord,
  AttributionWindowPolicy,
  MarketingSalesFeedbackSnapshot,
  RevenueEvidenceRecord,
} from '../measurement/attribution-revenue.js';

export interface WindowPolicyRow {
  readonly policy_id: string;
  readonly policy_key: string;
  readonly version: number;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly first_touch_lookback_days: number;
  readonly last_touch_lookback_days: number;
  readonly assisted_lookback_days: number;
  readonly idempotency_key: string;
  readonly execution_id: string;
  readonly correlation_id: string;
  readonly actor_principal_id: string;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

export interface TouchpointRow {
  readonly touchpoint_id: string;
  readonly dedupe_key: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly contact_id: string | null;
  readonly lead_id: string | null;
  readonly opportunity_id: string | null;
  readonly conversation_id: string | null;
  readonly message_id: string | null;
  readonly channel: string;
  readonly utm_source: string | null;
  readonly utm_medium: string | null;
  readonly utm_campaign: string | null;
  readonly utm_content: string | null;
  readonly utm_term: string | null;
  readonly meta_campaign_id: string | null;
  readonly meta_adset_id: string | null;
  readonly meta_ad_id: string | null;
  readonly meta_creative_id: string | null;
  readonly google_campaign_id: string | null;
  readonly google_ad_group_id: string | null;
  readonly google_ad_id: string | null;
  readonly google_creative_id: string | null;
  readonly click_id: string | null;
  readonly fbclid: string | null;
  readonly gclid: string | null;
  readonly gbraid: string | null;
  readonly wbraid: string | null;
  readonly landing_url: string | null;
  readonly session_id: string | null;
  readonly lead_source: string | null;
  readonly ticket_reference: string | null;
  readonly order_reference: string | null;
  readonly payment_reference: string | null;
  readonly checkout_reference: string | null;
  readonly message_ref: string | null;
  readonly intent: string | null;
  readonly demand_context: unknown;
  readonly attribution_source: string;
  readonly occurred_at: Date | string;
  readonly idempotency_key: string;
  readonly execution_id: string;
  readonly correlation_id: string;
  readonly actor_principal_id: string;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

export interface RevenueEvidenceRow {
  readonly revenue_evidence_id: string;
  readonly dedupe_key: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly opportunity_id: string;
  readonly contact_id: string;
  readonly lead_id: string | null;
  readonly conversation_id: string | null;
  readonly event_id: string | null;
  readonly source_type: RevenueEvidenceRecord['source'];
  readonly provider: string;
  readonly provider_event_id: string;
  readonly provider_evidence_ref: string;
  readonly external_reference: string;
  readonly status: RevenueEvidenceRecord['status'];
  readonly provider_readback_at: Date | string;
  readonly occurred_at: Date | string;
  readonly currency: string | null;
  readonly gross_revenue_minor: number | string | null;
  readonly net_revenue_minor: number | string | null;
  readonly refund_minor: number | string | null;
  readonly cost_minor: number | string | null;
  readonly ticket_reference: string | null;
  readonly order_reference: string | null;
  readonly payment_reference: string | null;
  readonly checkout_reference: string | null;
  readonly idempotency_key: string;
  readonly execution_id: string;
  readonly correlation_id: string;
  readonly actor_principal_id: string;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

export interface FeedbackRow {
  readonly feedback_id: string;
  readonly opportunity_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly marketing: unknown;
  readonly sales: unknown;
  readonly idempotency_key: string;
  readonly execution_id: string;
  readonly correlation_id: string;
  readonly actor_principal_id: string;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

export interface IdempotencyRow {
  readonly request_hash: string;
  readonly record_type: IntelligenceRecordType;
  readonly record_id: string;
  readonly response_snapshot: unknown;
}

export type IntelligenceRecordType =
  | 'ATTRIBUTION_WINDOW_POLICY'
  | 'ATTRIBUTION_TOUCHPOINT'
  | 'REVENUE_EVIDENCE'
  | 'MARKETING_SALES_FEEDBACK';

export type PersistedIntelligenceRecord =
  | AttributionWindowPolicy
  | AttributionTouchpointRecord
  | RevenueEvidenceRecord
  | MarketingSalesFeedbackSnapshot;

export interface PostgresAttributionRevenueStoreOptions {
  readonly outbox?: TransactionalOutboxWriter;
}
