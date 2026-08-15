import { describe, expect, it } from 'vitest';
import {
  assertCrmLeadStatusTransition,
  assertCrmOpportunityStatusTransition,
  normalizeCrmIdentityValue,
  normalizeCrmProvider,
  requireCrmEvidence,
  validateCrmCurrency,
  validateCrmValueMinor,
} from '../src/crm/crm-records.js';

describe('M-FOUND-10 CRM core record invariants', () => {
  it('normalizes canonical contact identities deterministically', () => {
    expect(normalizeCrmIdentityValue('EMAIL', ' Luiz@Example.COM ')).toBe('luiz@example.com');
    expect(normalizeCrmIdentityValue('PHONE', '+55 (75) 99999-0000')).toBe('+5575999990000');
    expect(normalizeCrmIdentityValue('SOCIAL_HANDLE', '@TocaDoMorcego')).toBe('tocadomorcego');
    expect(normalizeCrmIdentityValue('PROVIDER_ID', ' external-123 ')).toBe('external-123');
    expect(() => normalizeCrmIdentityValue('EMAIL', 'invalid')).toThrow('CRM_IDENTITY_EMAIL_INVALID');
  });

  it('requires providers only for provider-scoped identities', () => {
    expect(normalizeCrmProvider('SOCIAL_HANDLE', ' Instagram ')).toBe('instagram');
    expect(normalizeCrmProvider('PROVIDER_ID', 'DoTicket')).toBe('doticket');
    expect(normalizeCrmProvider('EMAIL', null)).toBeNull();
    expect(() => normalizeCrmProvider('SOCIAL_HANDLE', null)).toThrow(
      'CRM_IDENTITY_PROVIDER_REQUIRED',
    );
    expect(() => normalizeCrmProvider('EMAIL', 'provider')).toThrow(
      'CRM_IDENTITY_PROVIDER_NOT_ALLOWED',
    );
  });

  it('enforces lead lifecycle boundaries', () => {
    expect(() => assertCrmLeadStatusTransition('NEW', 'QUALIFYING')).not.toThrow();
    expect(() => assertCrmLeadStatusTransition('QUALIFIED', 'CONVERTED')).not.toThrow();
    expect(() => assertCrmLeadStatusTransition('DISQUALIFIED', 'ARCHIVED')).not.toThrow();
    expect(() => assertCrmLeadStatusTransition('CONVERTED', 'NEW')).toThrow(
      'CRM_LEAD_STATUS_TRANSITION_INVALID:CONVERTED:NEW',
    );
    expect(() => assertCrmLeadStatusTransition('ARCHIVED', 'QUALIFIED')).toThrow(
      'CRM_LEAD_STATUS_TRANSITION_INVALID:ARCHIVED:QUALIFIED',
    );
  });

  it('enforces opportunity terminal boundaries without hardcoding pipeline stages', () => {
    expect(() => assertCrmOpportunityStatusTransition('OPEN', 'WON')).not.toThrow();
    expect(() => assertCrmOpportunityStatusTransition('OPEN', 'LOST')).not.toThrow();
    expect(() => assertCrmOpportunityStatusTransition('WON', 'ARCHIVED')).not.toThrow();
    expect(() => assertCrmOpportunityStatusTransition('LOST', 'OPEN')).toThrow(
      'CRM_OPPORTUNITY_STATUS_TRANSITION_INVALID:LOST:OPEN',
    );
  });

  it('normalizes evidence and validates commercial value without creating finance semantics', () => {
    expect(requireCrmEvidence([' source:instagram ', 'source:instagram', 'manual:review'])).toEqual([
      'manual:review',
      'source:instagram',
    ]);
    expect(() => requireCrmEvidence([' ', ''])).toThrow('CRM_EVIDENCE_REQUIRED');
    expect(validateCrmCurrency('brl')).toBe('BRL');
    expect(() => validateCrmCurrency('REAL')).toThrow('CRM_CURRENCY_INVALID');
    expect(() => validateCrmValueMinor(0)).not.toThrow();
    expect(() => validateCrmValueMinor(17000)).not.toThrow();
    expect(() => validateCrmValueMinor(-1)).toThrow('CRM_VALUE_MINOR_INVALID');
    expect(() => validateCrmValueMinor(1.5)).toThrow('CRM_VALUE_MINOR_INVALID');
  });
});
