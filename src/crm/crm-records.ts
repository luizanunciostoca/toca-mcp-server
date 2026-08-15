export const CRM_CONTACT_TYPES = ['PERSON', 'ORGANIZATION'] as const;
export type CrmContactType = (typeof CRM_CONTACT_TYPES)[number];

export const CRM_CONTACT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type CrmContactStatus = (typeof CRM_CONTACT_STATUSES)[number];

export const CRM_IDENTITY_TYPES = ['EMAIL', 'PHONE', 'SOCIAL_HANDLE', 'PROVIDER_ID'] as const;
export type CrmIdentityType = (typeof CRM_IDENTITY_TYPES)[number];

export const CRM_LEAD_STATUSES = [
  'NEW',
  'QUALIFYING',
  'QUALIFIED',
  'NURTURING',
  'CONVERTED',
  'DISQUALIFIED',
  'ARCHIVED',
] as const;
export type CrmLeadStatus = (typeof CRM_LEAD_STATUSES)[number];

export const CRM_OPPORTUNITY_STATUSES = ['OPEN', 'WON', 'LOST', 'CANCELED', 'ARCHIVED'] as const;
export type CrmOpportunityStatus = (typeof CRM_OPPORTUNITY_STATUSES)[number];

export const CRM_ACTIVITY_DIRECTIONS = ['INBOUND', 'OUTBOUND', 'INTERNAL'] as const;
export type CrmActivityDirection = (typeof CRM_ACTIVITY_DIRECTIONS)[number];

export interface CrmContact {
  readonly contactId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly contactType: CrmContactType;
  readonly displayName: string;
  readonly status: CrmContactStatus;
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrmContactIdentity {
  readonly identityId: string;
  readonly contactId: string;
  readonly tenantId: string;
  readonly identityType: CrmIdentityType;
  readonly provider: string | null;
  readonly value: string;
  readonly normalizedValue: string;
  readonly primary: boolean;
  readonly verifiedAt: string | null;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface CrmLead {
  readonly leadId: string;
  readonly tenantId: string;
  readonly contactId: string;
  readonly eventId: string | null;
  readonly sourceType: string;
  readonly sourceRef: string | null;
  readonly status: CrmLeadStatus;
  readonly ownerPrincipalId: string | null;
  readonly capturedAt: string;
  readonly convertedAt: string | null;
  readonly disqualifiedReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrmOpportunity {
  readonly opportunityId: string;
  readonly tenantId: string;
  readonly contactId: string;
  readonly leadId: string | null;
  readonly eventId: string | null;
  readonly name: string;
  readonly stageKey: string;
  readonly status: CrmOpportunityStatus;
  readonly currency: string;
  readonly valueMinor: number | null;
  readonly ownerPrincipalId: string | null;
  readonly expectedCloseAt: string | null;
  readonly closedAt: string | null;
  readonly lossReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrmActivity {
  readonly activityId: string;
  readonly tenantId: string;
  readonly contactId: string;
  readonly leadId: string | null;
  readonly opportunityId: string | null;
  readonly eventId: string | null;
  readonly activityType: string;
  readonly direction: CrmActivityDirection;
  readonly channel: string;
  readonly summary: string;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly occurredAt: string;
  readonly createdAt: string;
}

export interface CreateCrmContactInput {
  readonly contactId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly contactType: CrmContactType;
  readonly displayName: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean | null>>;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface AttachCrmContactIdentityInput {
  readonly identityId: string;
  readonly contactId: string;
  readonly identityType: CrmIdentityType;
  readonly provider?: string | null;
  readonly value: string;
  readonly primary?: boolean;
  readonly verifiedAt?: string | null;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface CreateCrmLeadInput {
  readonly leadId: string;
  readonly contactId: string;
  readonly eventId?: string | null;
  readonly sourceType: string;
  readonly sourceRef?: string | null;
  readonly ownerPrincipalId?: string | null;
  readonly capturedAt?: string;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface TransitionCrmLeadInput {
  readonly leadId: string;
  readonly expectedVersion: number;
  readonly status: CrmLeadStatus;
  readonly ownerPrincipalId?: string | null;
  readonly disqualifiedReason?: string | null;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface CreateCrmOpportunityInput {
  readonly opportunityId: string;
  readonly contactId: string;
  readonly leadId?: string | null;
  readonly eventId?: string | null;
  readonly name: string;
  readonly stageKey: string;
  readonly currency?: string;
  readonly valueMinor?: number | null;
  readonly ownerPrincipalId?: string | null;
  readonly expectedCloseAt?: string | null;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface UpdateCrmOpportunityInput {
  readonly opportunityId: string;
  readonly expectedVersion: number;
  readonly name?: string;
  readonly stageKey?: string;
  readonly currency?: string;
  readonly valueMinor?: number | null;
  readonly ownerPrincipalId?: string | null;
  readonly expectedCloseAt?: string | null;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface TransitionCrmOpportunityInput {
  readonly opportunityId: string;
  readonly expectedVersion: number;
  readonly status: CrmOpportunityStatus;
  readonly lossReason?: string | null;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface AppendCrmActivityInput {
  readonly activityId: string;
  readonly contactId: string;
  readonly leadId?: string | null;
  readonly opportunityId?: string | null;
  readonly eventId?: string | null;
  readonly activityType: string;
  readonly direction: CrmActivityDirection;
  readonly channel: string;
  readonly summary: string;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly occurredAt?: string;
  readonly now?: string;
}

export interface CrmCoreStore {
  createContact(input: CreateCrmContactInput): Promise<CrmContact>;
  getContact(contactId: string): Promise<CrmContact | undefined>;
  attachIdentity(input: AttachCrmContactIdentityInput): Promise<CrmContactIdentity>;
  findContactByIdentity(input: {
    readonly tenantId: string;
    readonly identityType: CrmIdentityType;
    readonly provider?: string | null;
    readonly value: string;
  }): Promise<CrmContact | undefined>;
  createLead(input: CreateCrmLeadInput): Promise<CrmLead>;
  transitionLead(input: TransitionCrmLeadInput): Promise<CrmLead>;
  listLeadsForContact(contactId: string): Promise<readonly CrmLead[]>;
  createOpportunity(input: CreateCrmOpportunityInput): Promise<CrmOpportunity>;
  updateOpportunity(input: UpdateCrmOpportunityInput): Promise<CrmOpportunity>;
  transitionOpportunity(input: TransitionCrmOpportunityInput): Promise<CrmOpportunity>;
  listOpportunitiesForContact(contactId: string): Promise<readonly CrmOpportunity[]>;
  appendActivity(input: AppendCrmActivityInput): Promise<CrmActivity>;
  listActivitiesForContact(contactId: string, limit?: number): Promise<readonly CrmActivity[]>;
}

const LEAD_TRANSITIONS: Readonly<Record<CrmLeadStatus, readonly CrmLeadStatus[]>> = {
  NEW: ['QUALIFYING', 'QUALIFIED', 'NURTURING', 'DISQUALIFIED'],
  QUALIFYING: ['QUALIFIED', 'NURTURING', 'DISQUALIFIED'],
  QUALIFIED: ['NURTURING', 'CONVERTED', 'DISQUALIFIED'],
  NURTURING: ['QUALIFIED', 'CONVERTED', 'DISQUALIFIED'],
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
  if (!LEAD_TRANSITIONS[current].includes(next))
    throw new Error(`CRM_LEAD_STATUS_TRANSITION_INVALID:${current}:${next}`);
}

export function assertCrmOpportunityStatusTransition(
  current: CrmOpportunityStatus,
  next: CrmOpportunityStatus,
): void {
  if (current === next) return;
  if (!OPPORTUNITY_TRANSITIONS[current].includes(next))
    throw new Error(`CRM_OPPORTUNITY_STATUS_TRANSITION_INVALID:${current}:${next}`);
}

export function normalizeCrmIdentityValue(
  identityType: CrmIdentityType,
  value: string,
): string {
  const trimmed = requireText(value, 'CRM_IDENTITY_VALUE_REQUIRED');
  switch (identityType) {
    case 'EMAIL': {
      const normalized = trimmed.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
        throw new Error('CRM_IDENTITY_EMAIL_INVALID');
      return normalized;
    }
    case 'PHONE': {
      const normalized = trimmed.replace(/[\s().-]/g, '');
      if (!/^\+?\d{7,15}$/.test(normalized)) throw new Error('CRM_IDENTITY_PHONE_INVALID');
      return normalized;
    }
    case 'SOCIAL_HANDLE': {
      const normalized = trimmed.replace(/^@/, '').toLowerCase();
      if (!normalized) throw new Error('CRM_IDENTITY_SOCIAL_HANDLE_INVALID');
      return normalized;
    }
    case 'PROVIDER_ID':
      return trimmed;
  }
}

export function normalizeCrmProvider(
  identityType: CrmIdentityType,
  provider: string | null | undefined,
): string | null {
  const normalized = provider?.trim() || null;
  if (['SOCIAL_HANDLE', 'PROVIDER_ID'].includes(identityType) && normalized === null)
    throw new Error('CRM_IDENTITY_PROVIDER_REQUIRED');
  if (['EMAIL', 'PHONE'].includes(identityType) && normalized !== null)
    throw new Error('CRM_IDENTITY_PROVIDER_NOT_ALLOWED');
  return normalized?.toLowerCase() ?? null;
}

export function requireCrmEvidence(evidence: readonly string[]): readonly string[] {
  const normalized = [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error('CRM_EVIDENCE_REQUIRED');
  return normalized;
}

export function validateCrmAttributes(
  attributes: Readonly<Record<string, string | number | boolean | null>>,
): void {
  for (const [key, value] of Object.entries(attributes)) {
    requireText(key, 'CRM_ATTRIBUTE_KEY_REQUIRED');
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('CRM_ATTRIBUTE_VALUE_INVALID');
  }
}

export function validateCrmCurrency(currency: string): string {
  const normalized = requireText(currency, 'CRM_CURRENCY_REQUIRED').toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error('CRM_CURRENCY_INVALID');
  return normalized;
}

export function validateCrmValueMinor(value: number | null): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0))
    throw new Error('CRM_VALUE_MINOR_INVALID');
}

export function assertCrmLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('CRM_LIMIT_INVALID');
}

export function normalizeCrmTimestamp(value: string, errorCode: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(errorCode);
  return new Date(parsed).toISOString();
}

export function requireCrmText(value: string, errorCode: string): string {
  return requireText(value, errorCode);
}

export function nullableCrmText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
