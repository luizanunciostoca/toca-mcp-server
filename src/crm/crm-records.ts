export const CRM_CONTACT_TYPES = ['PERSON', 'ORGANIZATION'] as const;
export type CrmContactType = (typeof CRM_CONTACT_TYPES)[number];

export const CRM_CONTACT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type CrmContactStatus = (typeof CRM_CONTACT_STATUSES)[number];

export const CRM_CONTACT_CHANNEL_TYPES = ['EMAIL', 'PHONE', 'SOCIAL', 'OTHER'] as const;
export type CrmContactChannelType = (typeof CRM_CONTACT_CHANNEL_TYPES)[number];

export const CRM_LEAD_STATUSES = [
  'NEW',
  'WORKING',
  'QUALIFIED',
  'NURTURING',
  'CONVERTED',
  'DISQUALIFIED',
  'ARCHIVED',
] as const;
export type CrmLeadStatus = (typeof CRM_LEAD_STATUSES)[number];

export const CRM_LEAD_QUALIFICATIONS = [
  'UNQUALIFIED',
  'MARKETING_QUALIFIED',
  'SALES_QUALIFIED',
  'DISQUALIFIED',
] as const;
export type CrmLeadQualification = (typeof CRM_LEAD_QUALIFICATIONS)[number];

export const CRM_OPPORTUNITY_STATUSES = ['OPEN', 'WON', 'LOST', 'CANCELED', 'ARCHIVED'] as const;
export type CrmOpportunityStatus = (typeof CRM_OPPORTUNITY_STATUSES)[number];

export const CRM_RECORD_TYPES = ['CONTACT', 'LEAD', 'OPPORTUNITY'] as const;
export type CrmRecordType = (typeof CRM_RECORD_TYPES)[number];

export type CrmAttributes = Readonly<Record<string, string | number | boolean | null>>;

export interface CrmScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

export interface CrmMutationMetadata {
  readonly idempotencyKey: string;
  readonly executionId: string;
  readonly correlationId: string;
  readonly actorPrincipalId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface ContactRecord extends CrmScope {
  readonly contactId: string;
  readonly contactType: CrmContactType;
  readonly displayName: string;
  readonly status: CrmContactStatus;
  readonly attributes: CrmAttributes;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ContactChannelRecord extends CrmScope {
  readonly channelId: string;
  readonly contactId: string;
  readonly channelType: CrmContactChannelType;
  readonly provider: string | null;
  readonly value: string;
  readonly normalizedValue: string;
  readonly primary: boolean;
  readonly verifiedAt: string | null;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface LeadRecord extends CrmScope {
  readonly leadId: string;
  readonly contactId: string;
  readonly eventId: string | null;
  readonly sourceType: string;
  readonly sourceRef: string | null;
  readonly status: CrmLeadStatus;
  readonly qualification: CrmLeadQualification;
  readonly score: number | null;
  readonly ownerPrincipalId: string | null;
  readonly slaDueAt: string | null;
  readonly capturedAt: string;
  readonly qualifiedAt: string | null;
  readonly convertedAt: string | null;
  readonly disqualifiedReason: string | null;
  readonly attributes: CrmAttributes;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OpportunityRecord extends CrmScope {
  readonly opportunityId: string;
  readonly contactId: string;
  readonly leadId: string | null;
  readonly eventId: string | null;
  readonly name: string;
  readonly pipelineKey: string;
  readonly stageKey: string;
  readonly status: CrmOpportunityStatus;
  readonly currency: string | null;
  readonly valueMinor: number | null;
  readonly nextAction: string | null;
  readonly nextActionAt: string | null;
  readonly ownerPrincipalId: string | null;
  readonly expectedCloseAt: string | null;
  readonly closedAt: string | null;
  readonly lossReason: string | null;
  readonly attributes: CrmAttributes;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrmRecordRevision extends CrmScope {
  readonly recordType: CrmRecordType;
  readonly recordId: string;
  readonly revision: number;
  readonly changeType: string;
  readonly snapshot: ContactRecord | LeadRecord | OpportunityRecord;
  readonly details: Readonly<Record<string, unknown>>;
  readonly evidence: readonly string[];
  readonly executionId: string;
  readonly correlationId: string;
  readonly actorPrincipalId: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface CreateContactChannelInput {
  readonly channelId: string;
  readonly channelType: CrmContactChannelType;
  readonly provider?: string | null;
  readonly value: string;
  readonly primary?: boolean;
  readonly verifiedAt?: string | null;
}

export interface CreateContactRecordInput extends CrmScope, CrmMutationMetadata {
  readonly contactId: string;
  readonly contactType: CrmContactType;
  readonly displayName: string;
  readonly channels?: readonly CreateContactChannelInput[];
  readonly attributes?: CrmAttributes;
}

export interface UpdateContactRecordInput extends CrmScope, CrmMutationMetadata {
  readonly contactId: string;
  readonly expectedVersion: number;
  readonly displayName?: string;
  readonly status?: CrmContactStatus;
  readonly attributes?: CrmAttributes;
}

export interface AttachContactChannelInput extends CrmScope, CrmMutationMetadata {
  readonly channelId: string;
  readonly contactId: string;
  readonly expectedVersion: number;
  readonly channelType: CrmContactChannelType;
  readonly provider?: string | null;
  readonly value: string;
  readonly primary?: boolean;
  readonly verifiedAt?: string | null;
}

export interface CreateLeadRecordInput extends CrmScope, CrmMutationMetadata {
  readonly leadId: string;
  readonly contactId: string;
  readonly eventId?: string | null;
  readonly sourceType: string;
  readonly sourceRef?: string | null;
  readonly status?: CrmLeadStatus;
  readonly qualification?: CrmLeadQualification;
  readonly score?: number | null;
  readonly ownerPrincipalId?: string | null;
  readonly slaDueAt?: string | null;
  readonly capturedAt?: string;
  readonly attributes?: CrmAttributes;
}

export interface UpdateLeadRecordInput extends CrmScope, CrmMutationMetadata {
  readonly leadId: string;
  readonly expectedVersion: number;
  readonly status?: CrmLeadStatus;
  readonly qualification?: CrmLeadQualification;
  readonly score?: number | null;
  readonly ownerPrincipalId?: string | null;
  readonly slaDueAt?: string | null;
  readonly disqualifiedReason?: string | null;
  readonly attributes?: CrmAttributes;
}

export interface CreateOpportunityRecordInput extends CrmScope, CrmMutationMetadata {
  readonly opportunityId: string;
  readonly contactId: string;
  readonly leadId?: string | null;
  readonly eventId?: string | null;
  readonly name: string;
  readonly pipelineKey: string;
  readonly stageKey: string;
  readonly currency?: string | null;
  readonly valueMinor?: number | null;
  readonly nextAction?: string | null;
  readonly nextActionAt?: string | null;
  readonly ownerPrincipalId?: string | null;
  readonly expectedCloseAt?: string | null;
  readonly attributes?: CrmAttributes;
}

export interface UpdateOpportunityRecordInput extends CrmScope, CrmMutationMetadata {
  readonly opportunityId: string;
  readonly expectedVersion: number;
  readonly name?: string;
  readonly pipelineKey?: string;
  readonly stageKey?: string;
  readonly currency?: string | null;
  readonly valueMinor?: number | null;
  readonly nextAction?: string | null;
  readonly nextActionAt?: string | null;
  readonly ownerPrincipalId?: string | null;
  readonly expectedCloseAt?: string | null;
  readonly attributes?: CrmAttributes;
}

export interface TransitionOpportunityRecordInput extends CrmScope, CrmMutationMetadata {
  readonly opportunityId: string;
  readonly expectedVersion: number;
  readonly status: CrmOpportunityStatus;
  readonly lossReason?: string | null;
}

export interface CrmCoreStore {
  createContact(input: CreateContactRecordInput): Promise<ContactRecord>;
  getContact(input: CrmScope & { readonly contactId: string }): Promise<ContactRecord | undefined>;
  updateContact(input: UpdateContactRecordInput): Promise<ContactRecord>;
  attachContactChannel(input: AttachContactChannelInput): Promise<ContactChannelRecord>;
  findContactByChannel(
    input: CrmScope & {
      readonly channelType: CrmContactChannelType;
      readonly provider?: string | null;
      readonly value: string;
    },
  ): Promise<ContactRecord | undefined>;
  listContactChannels(
    input: CrmScope & { readonly contactId: string },
  ): Promise<readonly ContactChannelRecord[]>;
  createLead(input: CreateLeadRecordInput): Promise<LeadRecord>;
  getLead(input: CrmScope & { readonly leadId: string }): Promise<LeadRecord | undefined>;
  updateLead(input: UpdateLeadRecordInput): Promise<LeadRecord>;
  listLeadsForContact(
    input: CrmScope & { readonly contactId: string; readonly limit?: number },
  ): Promise<readonly LeadRecord[]>;
  createOpportunity(input: CreateOpportunityRecordInput): Promise<OpportunityRecord>;
  getOpportunity(
    input: CrmScope & { readonly opportunityId: string },
  ): Promise<OpportunityRecord | undefined>;
  updateOpportunity(input: UpdateOpportunityRecordInput): Promise<OpportunityRecord>;
  transitionOpportunity(input: TransitionOpportunityRecordInput): Promise<OpportunityRecord>;
  listOpportunitiesForContact(
    input: CrmScope & { readonly contactId: string; readonly limit?: number },
  ): Promise<readonly OpportunityRecord[]>;
  listRevisions(
    input: CrmScope & { readonly recordType: CrmRecordType; readonly recordId: string },
  ): Promise<readonly CrmRecordRevision[]>;
}

const LEAD_TRANSITIONS: Readonly<Record<CrmLeadStatus, readonly CrmLeadStatus[]>> = {
  NEW: ['WORKING', 'QUALIFIED', 'NURTURING', 'DISQUALIFIED'],
  WORKING: ['QUALIFIED', 'NURTURING', 'DISQUALIFIED'],
  QUALIFIED: ['NURTURING', 'CONVERTED', 'DISQUALIFIED'],
  NURTURING: ['WORKING', 'QUALIFIED', 'CONVERTED', 'DISQUALIFIED'],
  CONVERTED: ['ARCHIVED'],
  DISQUALIFIED: ['ARCHIVED'],
  ARCHIVED: [],
};

const OPPORTUNITY_TRANSITIONS: Readonly<
  Record<CrmOpportunityStatus, readonly CrmOpportunityStatus[]>
> = {
  OPEN: ['WON', 'LOST', 'CANCELED'],
  WON: ['ARCHIVED'],
  LOST: ['ARCHIVED'],
  CANCELED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function assertCrmLeadStatusTransition(current: CrmLeadStatus, next: CrmLeadStatus): void {
  if (current === next) return;
  if (!LEAD_TRANSITIONS[current].includes(next)) {
    throw new Error(`CRM_LEAD_STATUS_TRANSITION_INVALID:${current}:${next}`);
  }
}

export function assertCrmOpportunityStatusTransition(
  current: CrmOpportunityStatus,
  next: CrmOpportunityStatus,
): void {
  if (current === next) return;
  if (!OPPORTUNITY_TRANSITIONS[current].includes(next)) {
    throw new Error(`CRM_OPPORTUNITY_STATUS_TRANSITION_INVALID:${current}:${next}`);
  }
}

export function validateCrmScope(scope: CrmScope): void {
  requireCrmText(scope.tenantId, 'CRM_TENANT_ID_REQUIRED');
  requireCrmText(scope.workspaceId, 'CRM_WORKSPACE_ID_REQUIRED');
  requireCrmText(scope.organizationId, 'CRM_ORGANIZATION_ID_REQUIRED');
}

export function validateContactRecord(record: ContactRecord): void {
  validateCrmScope(record);
  requireCrmText(record.contactId, 'CRM_CONTACT_ID_REQUIRED');
  if (!CRM_CONTACT_TYPES.includes(record.contactType)) throw new Error('CRM_CONTACT_TYPE_INVALID');
  requireCrmText(record.displayName, 'CRM_CONTACT_DISPLAY_NAME_REQUIRED');
  if (!CRM_CONTACT_STATUSES.includes(record.status)) throw new Error('CRM_CONTACT_STATUS_INVALID');
  validateCrmAttributes(record.attributes);
  assertCrmVersion(record.version);
  normalizeCrmTimestamp(record.createdAt, 'CRM_CONTACT_CREATED_AT_INVALID');
  normalizeCrmTimestamp(record.updatedAt, 'CRM_CONTACT_UPDATED_AT_INVALID');
}

export function validateLeadRecord(record: LeadRecord): void {
  validateCrmScope(record);
  requireCrmText(record.leadId, 'CRM_LEAD_ID_REQUIRED');
  requireCrmText(record.contactId, 'CRM_CONTACT_ID_REQUIRED');
  requireCrmText(record.sourceType, 'CRM_LEAD_SOURCE_TYPE_REQUIRED');
  if (!CRM_LEAD_STATUSES.includes(record.status)) throw new Error('CRM_LEAD_STATUS_INVALID');
  if (!CRM_LEAD_QUALIFICATIONS.includes(record.qualification))
    throw new Error('CRM_LEAD_QUALIFICATION_INVALID');
  validateCrmScore(record.score);
  normalizeNullableTimestamp(record.slaDueAt, 'CRM_LEAD_SLA_DUE_AT_INVALID');
  normalizeCrmTimestamp(record.capturedAt, 'CRM_LEAD_CAPTURED_AT_INVALID');
  normalizeNullableTimestamp(record.qualifiedAt, 'CRM_LEAD_QUALIFIED_AT_INVALID');
  normalizeNullableTimestamp(record.convertedAt, 'CRM_LEAD_CONVERTED_AT_INVALID');
  if (record.status === 'QUALIFIED' && record.qualification === 'UNQUALIFIED') {
    throw new Error('CRM_LEAD_QUALIFICATION_REQUIRED');
  }
  if (record.status === 'CONVERTED' && record.qualification !== 'SALES_QUALIFIED') {
    throw new Error('CRM_LEAD_CONVERTED_REQUIRES_SALES_QUALIFICATION');
  }
  if (record.status === 'DISQUALIFIED') {
    if (record.qualification !== 'DISQUALIFIED')
      throw new Error('CRM_LEAD_DISQUALIFIED_QUALIFICATION_REQUIRED');
    if (record.disqualifiedReason === null)
      throw new Error('CRM_LEAD_DISQUALIFIED_REASON_REQUIRED');
  } else if (record.status !== 'ARCHIVED' && record.disqualifiedReason !== null) {
    throw new Error('CRM_LEAD_DISQUALIFIED_REASON_NOT_ALLOWED');
  }
  validateCrmAttributes(record.attributes);
  assertCrmVersion(record.version);
  normalizeCrmTimestamp(record.createdAt, 'CRM_LEAD_CREATED_AT_INVALID');
  normalizeCrmTimestamp(record.updatedAt, 'CRM_LEAD_UPDATED_AT_INVALID');
}

export function validateOpportunityRecord(record: OpportunityRecord): void {
  validateCrmScope(record);
  requireCrmText(record.opportunityId, 'CRM_OPPORTUNITY_ID_REQUIRED');
  requireCrmText(record.contactId, 'CRM_CONTACT_ID_REQUIRED');
  requireCrmText(record.name, 'CRM_OPPORTUNITY_NAME_REQUIRED');
  requireCrmText(record.pipelineKey, 'CRM_OPPORTUNITY_PIPELINE_REQUIRED');
  requireCrmText(record.stageKey, 'CRM_OPPORTUNITY_STAGE_REQUIRED');
  if (!CRM_OPPORTUNITY_STATUSES.includes(record.status))
    throw new Error('CRM_OPPORTUNITY_STATUS_INVALID');
  validateCrmMoney(record.currency, record.valueMinor);
  if (record.nextActionAt !== null && record.nextAction === null)
    throw new Error('CRM_OPPORTUNITY_NEXT_ACTION_REQUIRED');
  normalizeNullableTimestamp(record.nextActionAt, 'CRM_OPPORTUNITY_NEXT_ACTION_AT_INVALID');
  normalizeNullableTimestamp(record.expectedCloseAt, 'CRM_OPPORTUNITY_EXPECTED_CLOSE_AT_INVALID');
  normalizeNullableTimestamp(record.closedAt, 'CRM_OPPORTUNITY_CLOSED_AT_INVALID');
  if (record.status === 'OPEN' && record.closedAt !== null)
    throw new Error('CRM_OPPORTUNITY_OPEN_CLOSED_AT_NOT_ALLOWED');
  if (record.status !== 'OPEN' && record.closedAt === null) {
    throw new Error('CRM_OPPORTUNITY_CLOSED_AT_REQUIRED');
  }
  if (record.status === 'LOST' && record.lossReason === null)
    throw new Error('CRM_OPPORTUNITY_LOSS_REASON_REQUIRED');
  if (!['LOST', 'ARCHIVED'].includes(record.status) && record.lossReason !== null)
    throw new Error('CRM_OPPORTUNITY_LOSS_REASON_NOT_ALLOWED');
  validateCrmAttributes(record.attributes);
  assertCrmVersion(record.version);
  normalizeCrmTimestamp(record.createdAt, 'CRM_OPPORTUNITY_CREATED_AT_INVALID');
  normalizeCrmTimestamp(record.updatedAt, 'CRM_OPPORTUNITY_UPDATED_AT_INVALID');
}

export function normalizeCrmChannelValue(
  channelType: CrmContactChannelType,
  value: string,
): string {
  const trimmed = requireCrmText(value, 'CRM_CONTACT_CHANNEL_VALUE_REQUIRED');
  if (channelType === 'EMAIL') {
    const normalized = trimmed.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
      throw new Error('CRM_CONTACT_CHANNEL_EMAIL_INVALID');
    return normalized;
  }
  if (channelType === 'PHONE') {
    const normalized = trimmed.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
    if (!/^\+?\d{7,15}$/.test(normalized)) throw new Error('CRM_CONTACT_CHANNEL_PHONE_INVALID');
    return normalized;
  }
  return trimmed.toLowerCase();
}

export function normalizeCrmChannelProvider(
  channelType: CrmContactChannelType,
  provider: string | null | undefined,
): string | null {
  const normalized = nullableCrmText(provider)?.toLowerCase() ?? null;
  if (['SOCIAL', 'OTHER'].includes(channelType) && normalized === null)
    throw new Error('CRM_CONTACT_CHANNEL_PROVIDER_REQUIRED');
  if (['EMAIL', 'PHONE'].includes(channelType) && normalized !== null)
    throw new Error('CRM_CONTACT_CHANNEL_PROVIDER_NOT_ALLOWED');
  return normalized;
}

export function normalizeCrmCurrency(currency: string | null | undefined): string | null {
  const normalized = nullableCrmText(currency)?.toUpperCase() ?? null;
  if (normalized !== null && !/^[A-Z]{3}$/.test(normalized))
    throw new Error('CRM_CURRENCY_INVALID');
  return normalized;
}

export function validateCrmMoney(currency: string | null, valueMinor: number | null): void {
  if (valueMinor !== null && (!Number.isSafeInteger(valueMinor) || valueMinor < 0))
    throw new Error('CRM_VALUE_MINOR_INVALID');
  if (valueMinor !== null && currency === null) throw new Error('CRM_CURRENCY_REQUIRED');
  if (valueMinor === null && currency !== null) throw new Error('CRM_VALUE_REQUIRED_FOR_CURRENCY');
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) throw new Error('CRM_CURRENCY_INVALID');
}

export function validateCrmScore(score: number | null): void {
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100))
    throw new Error('CRM_LEAD_SCORE_INVALID');
}

export function requireCrmEvidence(evidence: readonly string[]): readonly string[] {
  const normalized = [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error('CRM_EVIDENCE_REQUIRED');
  return normalized;
}

export function validateCrmAttributes(attributes: CrmAttributes): void {
  for (const [key, value] of Object.entries(attributes)) {
    requireCrmText(key, 'CRM_ATTRIBUTE_KEY_REQUIRED');
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('CRM_ATTRIBUTE_VALUE_INVALID');
  }
}

export function assertCrmVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1) throw new Error('CRM_VERSION_INVALID');
}

export function assertCrmLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('CRM_LIMIT_INVALID');
}

export function normalizeCrmTimestamp(value: string, errorCode: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(errorCode);
  return new Date(parsed).toISOString();
}

export function normalizeNullableTimestamp(
  value: string | null | undefined,
  errorCode: string,
): string | null {
  return value === null || value === undefined ? null : normalizeCrmTimestamp(value, errorCode);
}

export function requireCrmText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

export function nullableCrmText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
