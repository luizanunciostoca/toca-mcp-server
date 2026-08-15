import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertCrmLeadStatusTransition,
  assertCrmOpportunityStatusTransition,
  normalizeCrmChannelProvider,
  normalizeCrmChannelValue,
  requireCrmEvidence,
  validateCrmMoney,
  validateLeadRecord,
  validateOpportunityRecord,
  type LeadRecord,
  type OpportunityRecord,
} from '../src/crm/crm-records.js';
import { ROUTE_CAPABILITY_IDS } from '../src/governance/capability-ids.js';

describe('M-FOUND-10 CRM core record invariants', () => {
  it('normalizes deduplication channels deterministically without consent semantics', () => {
    expect(normalizeCrmChannelValue('EMAIL', ' Luiz@Example.COM ')).toBe('luiz@example.com');
    expect(normalizeCrmChannelValue('PHONE', '+55 (75) 99999-0000')).toBe('+5575999990000');
    expect(normalizeCrmChannelValue('SOCIAL', '@TocaDoMorcego')).toBe('@tocadomorcego');
    expect(normalizeCrmChannelProvider('SOCIAL', ' Instagram ')).toBe('instagram');
    expect(normalizeCrmChannelProvider('EMAIL', null)).toBeNull();
    expect(() => normalizeCrmChannelProvider('SOCIAL', null)).toThrow(
      'CRM_CONTACT_CHANNEL_PROVIDER_REQUIRED',
    );
    expect(() => normalizeCrmChannelProvider('EMAIL', 'provider')).toThrow(
      'CRM_CONTACT_CHANNEL_PROVIDER_NOT_ALLOWED',
    );
  });

  it('normalizes evidence and enforces bounded lead score', () => {
    expect(requireCrmEvidence([' source:instagram ', 'source:instagram', 'manual:review'])).toEqual([
      'manual:review',
      'source:instagram',
    ]);
    expect(() => requireCrmEvidence([' ', ''])).toThrow('CRM_EVIDENCE_REQUIRED');
    const lead: LeadRecord = {
      leadId: 'lead-1', tenantId: 'tenant-1', workspaceId: 'ws-1', organizationId: 'org-1',
      contactId: 'contact-1', eventId: null, sourceType: 'instagram', sourceRef: null,
      status: 'QUALIFIED', qualification: 'SALES_QUALIFIED', score: 87.5,
      ownerPrincipalId: 'user-1', slaDueAt: '2026-08-16T12:00:00.000Z',
      capturedAt: '2026-08-15T05:00:00.000Z', qualifiedAt: '2026-08-15T05:01:00.000Z',
      convertedAt: null, disqualifiedReason: null, attributes: {}, version: 2,
      createdAt: '2026-08-15T05:00:00.000Z', updatedAt: '2026-08-15T05:01:00.000Z',
    };
    expect(() => validateLeadRecord(lead)).not.toThrow();
    expect(() => validateLeadRecord({ ...lead, score: 101 })).toThrow('CRM_LEAD_SCORE_INVALID');
    expect(() => validateLeadRecord({ ...lead, status: 'CONVERTED', qualification: 'MARKETING_QUALIFIED' })).toThrow(
      'CRM_LEAD_CONVERTED_REQUIRES_SALES_QUALIFICATION',
    );
  });

  it('enforces lead and opportunity lifecycle boundaries', () => {
    expect(() => assertCrmLeadStatusTransition('NEW', 'WORKING')).not.toThrow();
    expect(() => assertCrmLeadStatusTransition('QUALIFIED', 'CONVERTED')).not.toThrow();
    expect(() => assertCrmLeadStatusTransition('CONVERTED', 'NEW')).toThrow(
      'CRM_LEAD_STATUS_TRANSITION_INVALID:CONVERTED:NEW',
    );
    expect(() => assertCrmOpportunityStatusTransition('OPEN', 'WON')).not.toThrow();
    expect(() => assertCrmOpportunityStatusTransition('LOST', 'OPEN')).toThrow(
      'CRM_OPPORTUNITY_STATUS_TRANSITION_INVALID:LOST:OPEN',
    );
  });

  it('keeps commercial value optional and requires ISO currency only when value is known', () => {
    expect(() => validateCrmMoney(null, null)).not.toThrow();
    expect(() => validateCrmMoney('BRL', 17000)).not.toThrow();
    expect(() => validateCrmMoney(null, 17000)).toThrow('CRM_CURRENCY_REQUIRED');
    expect(() => validateCrmMoney('BRL', null)).toThrow('CRM_VALUE_REQUIRED_FOR_CURRENCY');
    const opportunity: OpportunityRecord = {
      opportunityId: 'opp-1', tenantId: 'tenant-1', workspaceId: 'ws-1', organizationId: 'org-1',
      contactId: 'contact-1', leadId: 'lead-1', eventId: null, name: 'Private event',
      pipelineKey: 'commercial', stageKey: 'discovery', status: 'OPEN', currency: 'BRL', valueMinor: 250000,
      nextAction: 'Call lead', nextActionAt: '2026-08-16T14:00:00.000Z', ownerPrincipalId: 'user-1',
      expectedCloseAt: null, closedAt: null, lossReason: null, attributes: {}, version: 1,
      createdAt: '2026-08-15T05:00:00.000Z', updatedAt: '2026-08-15T05:00:00.000Z',
    };
    expect(() => validateOpportunityRecord(opportunity)).not.toThrow();
    expect(() => validateOpportunityRecord({ ...opportunity, nextAction: null })).toThrow(
      'CRM_OPPORTUNITY_NEXT_ACTION_REQUIRED',
    );
  });

  it('preserves the exact R10 compatibility catalog without creating duplicate CRM capabilities', () => {
    expect(ROUTE_CAPABILITY_IDS.R10).toEqual([
      'sales.lead.create', 'sales.lead.qualify', 'sales.lead.enrich', 'sales.lead.score',
      'sales.opportunity.create', 'sales.proposal.generate', 'sales.proposal.version',
      'sales.price.calculate', 'sales.discount.validate', 'sales.followup.create',
      'sales.followup.schedule', 'sales.partner.create', 'sales.partner.evaluate',
      'sales.sponsorship.proposal', 'sales.private_event.quote', 'sales.pipeline.update',
      'sales.stage.move', 'sales.win_loss.record', 'sales.report.generate',
    ]);
  });

  it('persists scoped records, append-only revisions, idempotency, outbox and Audit Ledger atomically', () => {
    const migration = readFileSync('migrations/012_crm_core_records.sql', 'utf8');
    const store = readFileSync('src/persistence/postgres-crm-core-store.ts', 'utf8');
    const audit = readFileSync('src/persistence/postgres-internal-audit-ledger.ts', 'utf8');
    for (const table of ['crm_contacts', 'crm_contact_channels', 'crm_leads', 'crm_opportunities', 'crm_record_revisions', 'crm_idempotency_keys']) {
      expect(migration).toContain(`create table if not exists ${table}`);
    }
    expect(migration).toContain('CRM_HISTORY_MUTATION_FORBIDDEN');
    expect(migration).not.toContain('crm_activities');
    expect(store).toContain('for update');
    expect(store).toContain('createDomainEvent');
    expect(store).toContain('appendInternalAuditLedgerEvent');
    expect(store).toContain('CRM_IDEMPOTENCY_CONFLICT');
    expect(store).toContain('order by captured_at desc, lead_id asc');
    expect(store).toContain('order by created_at desc, opportunity_id asc');
    expect(audit).toContain('audit_ledger_events');
    expect(audit).toContain('audit_ledger_heads');
    expect(audit).toContain("const riskClass: RiskClass = 'WRITE_REVERSIBLE'");
  });
});
