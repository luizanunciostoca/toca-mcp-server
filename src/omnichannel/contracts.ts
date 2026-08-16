import type { ContactRecord } from '../crm/crm-records.js';
import type { PrivacyScope, SuppressionDecision } from '../privacy/contracts.js';

export const OMNICHANNEL_CHANNELS = ['WHATSAPP', 'EMAIL'] as const;
export type OmnichannelChannel = (typeof OMNICHANNEL_CHANNELS)[number];

export type ContactResolutionStatus = 'RESOLVED' | 'AMBIGUOUS' | 'NOT_FOUND';
export type ApprovalDecisionStatus = 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REVOKED';

export interface TenantScopeRef extends PrivacyScope {
  readonly correlationId: string;
}

export interface ContactResolutionProof extends TenantScopeRef {
  readonly contactRecordId: ContactRecord['contactId'] | null;
  readonly resolutionId: string;
  readonly status: ContactResolutionStatus;
}

export interface PrivacyDecisionProof extends TenantScopeRef {
  readonly decisionId: string;
  readonly subjectRef: string;
  readonly decision: SuppressionDecision;
}

export interface PolicyDecisionProof extends TenantScopeRef {
  readonly decisionId: string;
  readonly allowed: boolean;
}

export interface ApprovalDecisionProof extends TenantScopeRef {
  readonly approvalId: string;
  readonly status: ApprovalDecisionStatus;
}

export interface OutboundEligibilityContext extends TenantScopeRef {
  readonly channel: OmnichannelChannel;
  readonly contact: ContactResolutionProof;
  readonly privacy: PrivacyDecisionProof;
  readonly policy: PolicyDecisionProof;
  readonly approval?: ApprovalDecisionProof;
}

export interface AudienceEligibilitySnapshot extends TenantScopeRef {
  readonly snapshotId: string;
  readonly purposeId: string;
  readonly resolvedContactCount: number;
  readonly ambiguousContactCount: number;
  readonly unresolvedContactCount: number;
  readonly privacyUnknownBlockedCount: number;
  readonly privacySuppressedCount: number;
  readonly policyDeniedCount: number;
}

export interface ProviderBindingRef {
  readonly providerKey: string;
  readonly bindingId: string;
  readonly state: 'UNBOUND' | 'CONNECTED' | 'INTEGRATION_VALIDATED' | 'PRODUCTION_VALIDATED';
}

export interface ProviderSendRequest extends TenantScopeRef {
  readonly channel: OmnichannelChannel;
  readonly contactRecordId: ContactRecord['contactId'];
  readonly preparedPayloadRef: string;
  readonly idempotencyKey: string;
  readonly eligibility: OutboundEligibilityContext;
}

export interface ProviderSendReceipt {
  readonly provider: string;
  readonly providerMessageId: string;
  readonly acceptedAt: string;
  readonly state: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';
  readonly evidence: readonly string[];
}

export interface ProviderMessageReadback {
  readonly provider: string;
  readonly providerMessageId: string;
  readonly state: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'REJECTED' | 'UNKNOWN';
  readonly observedAt: string;
  readonly evidence: readonly string[];
}

export interface WhatsAppProviderAdapter {
  readonly binding: ProviderBindingRef;
  validateTemplate(input: {
    readonly templateKey: string;
    readonly locale: string;
    readonly variableNames: readonly string[];
  }): Promise<{ readonly valid: boolean; readonly evidence: readonly string[] }>;
  send(request: ProviderSendRequest): Promise<ProviderSendReceipt>;
  readback(providerMessageId: string): Promise<ProviderMessageReadback>;
}

export interface EmailProviderAdapter {
  readonly binding: ProviderBindingRef;
  sendCampaign(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
    readonly correlationId: string;
    readonly preparedCampaignRef: string;
    readonly eligibilitySnapshot: AudienceEligibilitySnapshot;
    readonly approval: ApprovalDecisionProof;
    readonly idempotencyKey: string;
  }): Promise<ProviderSendReceipt>;
  readback(providerMessageId: string): Promise<ProviderMessageReadback>;
}

export interface NurtureWorkflowBinding {
  readonly workflowDefinitionId: string;
  readonly workflowInstanceId: string | null;
}

export const OMNICHANNEL_REQUIRED_DEPENDENCIES = {
  crm: ['ContactRecord'],
  privacy: ['PrivacyScope', 'SuppressionDecision', 'privacy.suppression.check'],
  workflow: ['durable workflow engine', 'timers', 'human tasks', 'approval engine'],
  evidence: ['transactional outbox', 'audit ledger'],
} as const;

export function assertOutboundEligibility(
  context: OutboundEligibilityContext,
  options: { readonly approvalRequired: boolean } = { approvalRequired: true },
): void {
  validateScope(context);
  validateScopeMatch(context, context.contact, 'CONTACT');
  validateScopeMatch(context, context.privacy, 'PRIVACY');
  validateScopeMatch(context, context.policy, 'POLICY');

  if (context.contact.status !== 'RESOLVED' || !context.contact.contactRecordId?.trim()) {
    throw new Error('OMNICHANNEL_CONTACT_NOT_RESOLVED');
  }

  requireText(context.privacy.decisionId, 'OMNICHANNEL_PRIVACY_DECISION_ID_REQUIRED');
  requireText(context.privacy.subjectRef, 'OMNICHANNEL_PRIVACY_SUBJECT_REF_REQUIRED');
  requireText(context.privacy.decision.purposeId, 'OMNICHANNEL_PRIVACY_PURPOSE_REQUIRED');
  if (context.privacy.decision.channel !== context.channel) {
    throw new Error('OMNICHANNEL_PRIVACY_CHANNEL_MISMATCH');
  }
  if (context.privacy.decision.state === 'UNKNOWN_BLOCKED') {
    throw new Error('OMNICHANNEL_PRIVACY_UNKNOWN_BLOCKED');
  }
  if (context.privacy.decision.state === 'SUPPRESSED') {
    throw new Error('OMNICHANNEL_PRIVACY_SUPPRESSED');
  }
  if (context.privacy.decision.state !== 'ALLOWED' || context.privacy.decision.blocked) {
    throw new Error('OMNICHANNEL_PRIVACY_NOT_ALLOWED');
  }

  if (!context.policy.allowed) {
    throw new Error('OMNICHANNEL_POLICY_DENIED');
  }

  if (options.approvalRequired) {
    if (!context.approval) throw new Error('OMNICHANNEL_APPROVAL_REQUIRED');
    validateScopeMatch(context, context.approval, 'APPROVAL');
    if (context.approval.status !== 'APPROVED') {
      throw new Error('OMNICHANNEL_APPROVAL_NOT_ACTIVE');
    }
  }
}

export function assertAudienceEligibilitySnapshot(snapshot: AudienceEligibilitySnapshot): void {
  validateScope(snapshot);
  requireText(snapshot.snapshotId, 'OMNICHANNEL_AUDIENCE_SNAPSHOT_ID_REQUIRED');
  requireText(snapshot.purposeId, 'OMNICHANNEL_AUDIENCE_PURPOSE_REQUIRED');

  const counters = [
    snapshot.resolvedContactCount,
    snapshot.ambiguousContactCount,
    snapshot.unresolvedContactCount,
    snapshot.privacyUnknownBlockedCount,
    snapshot.privacySuppressedCount,
    snapshot.policyDeniedCount,
  ];
  if (counters.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('OMNICHANNEL_AUDIENCE_COUNTER_INVALID');
  }
  if (snapshot.resolvedContactCount < 1) {
    throw new Error('OMNICHANNEL_AUDIENCE_EMPTY');
  }
  if (
    snapshot.ambiguousContactCount > 0 ||
    snapshot.unresolvedContactCount > 0 ||
    snapshot.privacyUnknownBlockedCount > 0 ||
    snapshot.privacySuppressedCount > 0 ||
    snapshot.policyDeniedCount > 0
  ) {
    throw new Error('OMNICHANNEL_AUDIENCE_NOT_ELIGIBLE');
  }
}

export function assertProductionProviderBinding(binding: ProviderBindingRef): void {
  requireText(binding.providerKey, 'OMNICHANNEL_PROVIDER_KEY_REQUIRED');
  requireText(binding.bindingId, 'OMNICHANNEL_PROVIDER_BINDING_ID_REQUIRED');
  if (binding.state !== 'PRODUCTION_VALIDATED') {
    throw new Error('OMNICHANNEL_PROVIDER_NOT_PRODUCTION_VALIDATED');
  }
}

function validateScope(scope: TenantScopeRef): void {
  requireText(scope.tenantId, 'OMNICHANNEL_TENANT_ID_REQUIRED');
  requireText(scope.workspaceId, 'OMNICHANNEL_WORKSPACE_ID_REQUIRED');
  requireText(scope.organizationId, 'OMNICHANNEL_ORGANIZATION_ID_REQUIRED');
  requireText(scope.correlationId, 'OMNICHANNEL_CORRELATION_ID_REQUIRED');
}

function validateScopeMatch(
  expected: TenantScopeRef,
  actual: TenantScopeRef,
  component: string,
): void {
  validateScope(actual);
  if (
    actual.tenantId !== expected.tenantId ||
    actual.workspaceId !== expected.workspaceId ||
    actual.organizationId !== expected.organizationId ||
    actual.correlationId !== expected.correlationId
  ) {
    throw new Error(`OMNICHANNEL_${component}_SCOPE_MISMATCH`);
  }
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
