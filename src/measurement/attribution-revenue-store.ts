import type {
  AttributionTouchpointRecord,
  AttributionWindowPolicy,
  MarketingSalesFeedbackSnapshot,
  RevenueEvidenceRecord,
} from './attribution-revenue.js';

export interface AttributionRevenueScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

export interface AttributionTouchpointQuery extends AttributionRevenueScope {
  readonly contactId?: string | null;
  readonly leadId?: string | null;
  readonly opportunityId?: string | null;
  readonly conversationId?: string | null;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export interface RevenueEvidenceQuery extends AttributionRevenueScope {
  readonly opportunityId: string;
  readonly limit?: number;
}

export interface AttributionRevenueStore {
  recordWindowPolicy(policy: AttributionWindowPolicy): Promise<AttributionWindowPolicy>;
  latestWindowPolicy(
    scope: AttributionRevenueScope & { readonly policyKey: string },
  ): Promise<AttributionWindowPolicy | undefined>;
  recordTouchpoint(touchpoint: AttributionTouchpointRecord): Promise<AttributionTouchpointRecord>;
  listTouchpoints(
    query: AttributionTouchpointQuery,
  ): Promise<readonly AttributionTouchpointRecord[]>;
  recordRevenueEvidence(record: RevenueEvidenceRecord): Promise<RevenueEvidenceRecord>;
  listRevenueEvidence(query: RevenueEvidenceQuery): Promise<readonly RevenueEvidenceRecord[]>;
  recordFeedbackSnapshot(
    snapshot: MarketingSalesFeedbackSnapshot,
  ): Promise<MarketingSalesFeedbackSnapshot>;
  latestFeedbackSnapshot(
    scope: AttributionRevenueScope & { readonly opportunityId: string },
  ): Promise<MarketingSalesFeedbackSnapshot | undefined>;
}
