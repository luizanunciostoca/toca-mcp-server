import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/028_attribution_revenue_feedback.sql', 'utf8');
const store = readFileSync('src/persistence/postgres-attribution-revenue-store.ts', 'utf8');
const storeSupport = readFileSync(
  'src/persistence/postgres-attribution-revenue-store-support.ts',
  'utf8',
);
const service = readFileSync('src/measurement/attribution-revenue-service.ts', 'utf8');

describe('Attribution + Revenue PostgreSQL contract', () => {
  it('extends canonical CRM/measurement persistence without parallel infrastructure', () => {
    for (const table of [
      'attribution_window_policies',
      'attribution_touchpoints',
      'revenue_evidence_records',
      'marketing_sales_feedback_snapshots',
      'measurement_intelligence_idempotency',
    ]) {
      expect(migration).toContain(`create table if not exists ${table}`);
    }
    expect(migration).not.toContain('create table if not exists crm_contacts');
    expect(migration).not.toContain('create table if not exists event_outbox');
    expect(store).toContain('PostgresTransactionalOutbox');
    expect(store).toContain('appendInternalMeasurementAuditLedgerEvent');
  });

  it('makes commerce readback the only durable WON evidence boundary', () => {
    expect(migration).toContain("source_type in ('TICKETING', 'CHECKOUT', 'PAYMENT', 'ORDER')");
    expect(migration).toContain('provider_evidence_ref text not null');
    expect(migration).toContain('provider_readback_at timestamptz not null');
    expect(migration).toContain('enforce_crm_won_verified_conversion_evidence');
    expect(migration).toContain('CRM_WON_REQUIRES_VERIFIED_CONVERSION_EVIDENCE');
    expect(migration).not.toMatch(/source_type in \([^)]*(CLICK|DM)/);
    expect(service).toContain('assertReliableWonEvidence(revenueEvidence)');
    expect(service).toContain('this.crm.transitionOpportunity');
  });

  it('captures required marketing, sales and future Google lineage', () => {
    for (const column of [
      'meta_campaign_id',
      'meta_adset_id',
      'meta_ad_id',
      'meta_creative_id',
      'google_campaign_id',
      'google_ad_group_id',
      'google_ad_id',
      'google_creative_id',
      'click_id',
      'fbclid',
      'gclid',
      'gbraid',
      'wbraid',
      'landing_url',
      'session_id',
      'lead_source',
      'conversation_id',
      'message_id',
      'ticket_reference',
      'order_reference',
      'payment_reference',
      'checkout_reference',
      'intent',
      'demand_context',
    ]) {
      expect(migration).toContain(`${column} `);
    }
  });

  it('keeps append-only history and scoped dedupe/idempotency', () => {
    expect(migration).toContain('ATTRIBUTION_REVENUE_HISTORY_MUTATION_FORBIDDEN');
    expect(migration).toContain('unique (tenant_id, workspace_id, organization_id, dedupe_key)');
    expect(migration).toContain(
      'primary key (tenant_id, workspace_id, organization_id, operation, idempotency_key)',
    );
    expect(storeSupport).toContain('MEASUREMENT_INTELLIGENCE_IDEMPOTENCY_CONFLICT');
  });
});
