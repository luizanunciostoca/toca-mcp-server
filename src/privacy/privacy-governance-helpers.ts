import type { ApprovalRecord } from '../governance/approval-governance.js';
import type {
  PrivacyCapabilityId,
  PrivacyExecutionContext,
  PrivacyLedgerEvent,
  PrivacyLedgerEventType,
  PrivacyScope,
  PrivacySubjectRequestStatus,
  PrivacySubjectRequestType,
  SubjectRequestSnapshot,
} from './contracts.js';

export interface AppendInput {
  readonly context: PrivacyExecutionContext;
  readonly subjectRef: string;
  readonly requestId: string | null;
  readonly purposeId: string | null;
  readonly channel: string | null;
  readonly policyRef: string | null;
  readonly approvalId: string | null;
  readonly capabilityId: PrivacyCapabilityId;
  readonly eventType: PrivacyLedgerEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly extraEvidence: readonly string[];
}

export function privacyApprovalDescriptor(
  input: PrivacyScope & {
    readonly capabilityId: 'privacy.data_export.prepare' | 'privacy.data_delete.execute';
    readonly subjectRef: string;
    readonly requestId: string;
    readonly requestType: PrivacySubjectRequestType;
    readonly identityVerificationRef: string;
    readonly policyRef: string;
    readonly operationParameters: string;
  },
): Readonly<Record<string, string>> {
  validateScope(input);
  if (!isRequestType(input.requestType)) throw new Error('PRIVACY_SUBJECT_REQUEST_TYPE_INVALID');
  return {
    capabilityId: input.capabilityId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    subjectRef: requireOpaqueSubjectRef(input.subjectRef),
    requestId: requireText(input.requestId, 'PRIVACY_REQUEST_ID_REQUIRED'),
    requestType: input.requestType,
    identityVerificationRef: requireSafeText(
      input.identityVerificationRef,
      'PRIVACY_IDENTITY_VERIFICATION_REF_REQUIRED',
    ),
    policyRef: requireSafeText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
    operationParameters: requireSafeText(
      input.operationParameters,
      'PRIVACY_OPERATION_PARAMETERS_REQUIRED',
    ),
  };
}

export function privacyApprovalScope(
  scope: PrivacyScope,
  subjectRef: string,
  operation: 'export' | 'delete',
): string {
  validateScope(scope);
  return [
    'privacy',
    scope.tenantId,
    scope.workspaceId,
    scope.organizationId,
    requireOpaqueSubjectRef(subjectRef),
    operation,
  ].join(':');
}

export function snapshotFromEvents(events: readonly PrivacyLedgerEvent[]): SubjectRequestSnapshot {
  const created = events.find((event) => event.eventType === 'SUBJECT_REQUEST_CREATED');
  if (!created || !created.requestId || !created.policyRef)
    throw new Error('PRIVACY_SUBJECT_REQUEST_CORRUPT');
  const statusEvent = latest(
    events,
    (event) =>
      event.eventType === 'SUBJECT_REQUEST_STATUS_CHANGED' ||
      event.eventType === 'DATA_EXPORT_PREPARED' ||
      event.eventType === 'DATA_DELETE_EXECUTED',
  );
  const inferredStatus: PrivacySubjectRequestStatus =
    statusEvent?.eventType === 'DATA_EXPORT_PREPARED' ||
    statusEvent?.eventType === 'DATA_DELETE_EXECUTED'
      ? 'COMPLETED'
      : isRequestStatus(statusEvent?.payload.status)
        ? statusEvent.payload.status
        : isRequestStatus(created.payload.status)
          ? created.payload.status
          : 'REQUESTED';
  const requestType = created.payload.requestType;
  if (!isRequestType(requestType)) throw new Error('PRIVACY_SUBJECT_REQUEST_TYPE_INVALID');
  const identityVerificationRef =
    typeof created.payload.identityVerificationRef === 'string'
      ? created.payload.identityVerificationRef
      : null;
  return {
    requestId: created.requestId,
    tenantId: created.tenantId,
    workspaceId: created.workspaceId,
    organizationId: created.organizationId,
    subjectRef: created.subjectRef,
    requestType,
    status: inferredStatus,
    identityVerificationRef,
    requester: created.requester,
    createdAt: created.occurredAt,
    updatedAt: statusEvent?.occurredAt ?? created.occurredAt,
    policyRef: created.policyRef,
    evidence: unique(events.flatMap((event) => event.evidence)),
  };
}

export function assertApprovalBinding(
  approval: ApprovalRecord,
  tenantId: string,
  capabilityId: PrivacyCapabilityId,
): void {
  if (approval.routeId !== 'R16') throw new Error('PRIVACY_APPROVAL_ROUTE_MISMATCH');
  if (approval.capabilityId !== capabilityId)
    throw new Error('PRIVACY_APPROVAL_CAPABILITY_MISMATCH');
  if (approval.targetAccount !== tenantId) throw new Error('PRIVACY_APPROVAL_TENANT_MISMATCH');
}

export function latest(
  events: readonly PrivacyLedgerEvent[],
  predicate: (event: PrivacyLedgerEvent) => boolean,
): PrivacyLedgerEvent | undefined {
  return events.filter(predicate).at(-1);
}

export function latestConsentTransition(
  events: readonly PrivacyLedgerEvent[],
  purposeId: string,
  channel: string,
): PrivacyLedgerEvent | undefined {
  return latest(
    events,
    (event) =>
      event.purposeId === purposeId &&
      event.channel === channel &&
      (event.eventType === 'CONSENT_RECORDED' || event.eventType === 'CONSENT_REVOKED'),
  );
}

export function consentVersionOf(event: PrivacyLedgerEvent): number {
  const value = event.payload.consentVersion;
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new Error('PRIVACY_CONSENT_HISTORY_VERSION_INVALID');
  return Number(value);
}

export function previousConsentEventId(event: PrivacyLedgerEvent): string | null {
  const value = event.payload.previousConsentEventId;
  return typeof value === 'string' ? value : null;
}

export function isRequestStatus(value: unknown): value is PrivacySubjectRequestStatus {
  return (
    typeof value === 'string' &&
    [
      'REQUESTED',
      'IDENTITY_VERIFICATION_REQUIRED',
      'IN_REVIEW',
      'APPROVAL_REQUIRED',
      'APPROVED',
      'EXECUTING',
      'COMPLETED',
      'DENIED',
      'CANCELLED',
    ].includes(value)
  );
}

export function isRequestType(value: unknown): value is PrivacySubjectRequestType {
  return (
    typeof value === 'string' &&
    [
      'CONFIRMATION',
      'ACCESS',
      'CORRECTION',
      'PORTABILITY',
      'DELETE',
      'CONSENT_REVOCATION',
      'INFORMATION',
      'AUTOMATED_DECISION_REVIEW',
      'OTHER',
    ].includes(value)
  );
}

export function scopeFromContext(context: PrivacyExecutionContext): PrivacyScope {
  return validateScope(context);
}

export function validateScope(scope: PrivacyScope): PrivacyScope {
  return {
    tenantId: requireSafeText(scope.tenantId, 'PRIVACY_TENANT_REQUIRED'),
    workspaceId: requireSafeText(scope.workspaceId, 'PRIVACY_WORKSPACE_REQUIRED'),
    organizationId: requireSafeText(scope.organizationId, 'PRIVACY_ORGANIZATION_REQUIRED'),
  };
}

export function assertContext(context: PrivacyExecutionContext): void {
  validateScope(context);
  requireActorRef(context.requester);
  requireSafeText(context.executionId, 'PRIVACY_EXECUTION_ID_REQUIRED');
  requireSafeText(context.correlationId, 'PRIVACY_CORRELATION_ID_REQUIRED');
  requireEvidence(context.evidence, 'PRIVACY_EXECUTION_EVIDENCE_REQUIRED');
}

export function requireOpaqueSubjectRef(value: string): string {
  const normalized = requireText(value, 'PRIVACY_SUBJECT_REQUIRED');
  if (normalized.length > 256) throw new Error('PRIVACY_SUBJECT_REF_INVALID');
  if (/\s/.test(normalized) || /^(?:mailto|tel):/i.test(normalized))
    throw new Error('PRIVACY_SUBJECT_REF_NOT_OPAQUE');
  assertNoRawPii(normalized, 'PRIVACY_SUBJECT_REF_NOT_OPAQUE');
  return normalized;
}

export function requireActorRef(value: string): string {
  const normalized = requireText(value, 'PRIVACY_REQUESTER_REQUIRED');
  if (/\s/.test(normalized)) throw new Error('PRIVACY_REQUESTER_REF_INVALID');
  assertNoRawPii(normalized, 'PRIVACY_REQUESTER_REF_INVALID');
  return normalized;
}

export function requireSafeText(value: string, errorCode: string): string {
  const normalized = requireText(value, errorCode);
  assertNoRawPii(normalized, 'PRIVACY_RAW_PII_REJECTED');
  return normalized;
}

export function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

export function requireTimestamp(value: string, errorCode: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(errorCode);
  return new Date(value).toISOString();
}

export function requireEvidence(values: readonly string[], errorCode: string): readonly string[] {
  const evidence = unique(values.map((value) => requireText(value, errorCode)).filter(Boolean));
  if (evidence.length === 0) throw new Error(errorCode);
  assertNoRawPii(evidence, 'PRIVACY_RAW_PII_EVIDENCE_REJECTED');
  return evidence;
}

export function assertNoRawPii(value: unknown, errorCode: string): void {
  if (typeof value === 'string') {
    if (looksLikeRawPii(value)) throw new Error(errorCode);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoRawPii(item, errorCode);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>))
      assertNoRawPii(item, errorCode);
  }
}

export function looksLikeRawPii(value: string): boolean {
  const withoutOpaqueIds = value.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    '',
  );
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const cpf = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
  const phone = /(?:^|[^\w])\+?\d[\d\s().-]{7,}\d(?:$|[^\w])/;
  return email.test(withoutOpaqueIds) || cpf.test(withoutOpaqueIds) || phone.test(withoutOpaqueIds);
}

export function assertIdempotentEquivalent(
  existing: PrivacyLedgerEvent,
  candidate: PrivacyLedgerEvent,
): void {
  const existingComparable = comparableEvent(existing);
  const candidateComparable = comparableEvent(candidate);
  if (JSON.stringify(existingComparable) !== JSON.stringify(candidateComparable))
    throw new Error('PRIVACY_IDEMPOTENCY_CONFLICT');
}

export function comparableEvent(event: PrivacyLedgerEvent): Readonly<Record<string, unknown>> {
  return {
    tenantId: event.tenantId,
    workspaceId: event.workspaceId,
    organizationId: event.organizationId,
    subjectRef: event.subjectRef,
    requestId: event.requestId,
    purposeId: event.purposeId,
    channel: event.channel,
    policyRef: event.policyRef,
    approvalId: event.approvalId,
    capabilityId: event.capabilityId,
    eventType: event.eventType,
    requester: event.requester,
    executionId: event.executionId,
    correlationId: event.correlationId,
    evidence: [...event.evidence].sort(),
    payload: event.payload,
  };
}

export function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && error.message === code;
}

export function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
