import { createHash } from 'node:crypto';
import { authorizeExecution, type ExecutionIdentity } from '../core/identity.js';
import type { CrmCoreStore, LeadRecord, OpportunityRecord } from '../crm/crm-records.js';
import type { AttributionMutationMetadata } from './attribution-revenue.js';
import type { MeasurementOperationContext } from './service.js';
import { normalizeEvidence, nullableText, requireText, timestamp } from './normalization.js';

export interface CrmAttributionLineage {
  readonly contactId: string | null;
  readonly leadId: string | null;
  readonly opportunityId: string | null;
  readonly lead: LeadRecord | null;
}

export function attributionMetadata(
  context: MeasurementOperationContext,
  idempotencyKey: string,
  extraEvidence: readonly string[] = [],
): AttributionMutationMetadata {
  return {
    idempotencyKey: requireText(idempotencyKey, 'ATTRIBUTION_IDEMPOTENCY_KEY_REQUIRED'),
    executionId: requireText(context.executionId, 'ATTRIBUTION_EXECUTION_ID_REQUIRED'),
    correlationId: requireText(context.correlationId, 'ATTRIBUTION_CORRELATION_ID_REQUIRED'),
    actorPrincipalId: context.identity.principal.principalId,
    evidence: normalizeEvidence([...context.evidence, ...extraEvidence]),
    createdAt: timestamp(context.now ?? new Date().toISOString(), 'ATTRIBUTION_CREATED_AT_INVALID'),
  };
}

export function assertAttributionAuthorized(
  identity: ExecutionIdentity,
  capabilityId: string,
  riskClass: 'READ' | 'WRITE_REVERSIBLE',
): void {
  const decision = authorizeExecution(identity, { routeId: 'R31', capabilityId, riskClass });
  if (!decision.allowed) throw new Error(`AUTHORIZATION_DENIED:${decision.reason}`);
}

export function normalizeRevenueCurrency(value: string | null | undefined): string | null {
  const normalized = nullableText(value)?.toUpperCase() ?? null;
  if (normalized && !/^[A-Z]{3}$/.test(normalized)) throw new Error('REVENUE_CURRENCY_INVALID');
  return normalized;
}

export function attributionHashKey(values: readonly string[]): string {
  return createHash('sha256').update(values.join('|'), 'utf8').digest('hex');
}

export function attributionRecordId(input: {
  readonly explicit: string | undefined;
  readonly prefix: string;
  readonly context: MeasurementOperationContext;
  readonly idempotencyKey: string;
  readonly createId: (() => string) | undefined;
}): string {
  if (input.explicit) return requireText(input.explicit, 'ATTRIBUTION_RECORD_ID_REQUIRED');
  if (input.createId) return requireText(input.createId(), 'ATTRIBUTION_RECORD_ID_REQUIRED');
  const principal = input.context.identity.principal;
  return `${input.prefix}_${attributionHashKey([
    principal.tenantId,
    principal.workspaceId,
    principal.organizationId,
    requireText(input.idempotencyKey, 'ATTRIBUTION_IDEMPOTENCY_KEY_REQUIRED'),
  ]).slice(0, 40)}`;
}

export async function requireRevenueOpportunity(
  crm: CrmCoreStore,
  identity: ExecutionIdentity,
  opportunityId: string,
): Promise<OpportunityRecord> {
  const principal = identity.principal;
  const opportunity = await crm.getOpportunity({
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    organizationId: principal.organizationId,
    opportunityId: requireText(opportunityId, 'REVENUE_OPPORTUNITY_ID_REQUIRED'),
  });
  if (!opportunity) throw new Error('REVENUE_OPPORTUNITY_NOT_FOUND');
  return opportunity;
}

export async function resolveCrmAttributionLineage(
  crm: CrmCoreStore,
  identity: ExecutionIdentity,
  input: {
    readonly contactId?: string | null;
    readonly leadId?: string | null;
    readonly opportunityId?: string | null;
  },
): Promise<CrmAttributionLineage> {
  const principal = identity.principal;
  const opportunityId = nullableText(input.opportunityId);
  if (opportunityId) {
    const opportunity = await requireRevenueOpportunity(crm, identity, opportunityId);
    const requestedContactId = nullableText(input.contactId);
    const requestedLeadId = nullableText(input.leadId);
    if (requestedContactId && requestedContactId !== opportunity.contactId) {
      throw new Error('ATTRIBUTION_CONTACT_OPPORTUNITY_MISMATCH');
    }
    if (requestedLeadId && requestedLeadId !== opportunity.leadId) {
      throw new Error('ATTRIBUTION_LEAD_OPPORTUNITY_MISMATCH');
    }
    const lead = opportunity.leadId
      ? ((await crm.getLead({
          tenantId: principal.tenantId,
          workspaceId: principal.workspaceId,
          organizationId: principal.organizationId,
          leadId: opportunity.leadId,
        })) ?? null)
      : null;
    return {
      contactId: opportunity.contactId,
      leadId: opportunity.leadId,
      opportunityId: opportunity.opportunityId,
      lead,
    };
  }

  const leadId = nullableText(input.leadId);
  if (leadId) {
    const lead = await crm.getLead({
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId,
      organizationId: principal.organizationId,
      leadId,
    });
    if (!lead) throw new Error('ATTRIBUTION_LEAD_NOT_FOUND');
    const requestedContactId = nullableText(input.contactId);
    if (requestedContactId && requestedContactId !== lead.contactId) {
      throw new Error('ATTRIBUTION_CONTACT_LEAD_MISMATCH');
    }
    return { contactId: lead.contactId, leadId: lead.leadId, opportunityId: null, lead };
  }

  const contactId = nullableText(input.contactId);
  if (contactId) {
    const contact = await crm.getContact({
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId,
      organizationId: principal.organizationId,
      contactId,
    });
    if (!contact) throw new Error('ATTRIBUTION_CONTACT_NOT_FOUND');
    return { contactId: contact.contactId, leadId: null, opportunityId: null, lead: null };
  }
  return { contactId: null, leadId: null, opportunityId: null, lead: null };
}
