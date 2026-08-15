import { createHash, randomUUID } from 'node:crypto';
import { getCapabilityDefinition } from './capability-catalog.js';
import { isRouteId, type RouteId } from './types.js';

export const APPROVAL_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'RESERVED',
  'EXECUTING',
  'PROVIDER_READBACK',
  'CONSUMED',
  'RELEASED',
  'FAILED_REVIEW_REQUIRED',
  'REVOKED',
  'EXPIRED',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_EXECUTION_STATUSES = [
  'RESERVED',
  'EXECUTING',
  'PROVIDER_READBACK',
  'CONSUMED',
  'RELEASED',
  'FAILED_REVIEW_REQUIRED',
] as const;
export type ApprovalExecutionStatus = (typeof APPROVAL_EXECUTION_STATUSES)[number];

const RESERVABLE_STATUSES: ReadonlySet<ApprovalStatus> = new Set(['APPROVED', 'RELEASED']);
const DIRECT_PUT_FORBIDDEN_STATUSES: ReadonlySet<ApprovalStatus> = new Set(
  APPROVAL_EXECUTION_STATUSES,
);

export interface ApprovalFinancialCeiling {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface ApprovalRecord {
  readonly approvalId: string;
  readonly requester: string;
  readonly approver: string | null;
  readonly routeId: RouteId;
  readonly capabilityId: string;
  readonly descriptorSha256: string;
  readonly targetAccount: string;
  readonly scope: readonly string[];
  readonly financialCeiling: ApprovalFinancialCeiling | null;
  readonly requestedAt: string;
  readonly issuedAt: string | null;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly revokedAt: string | null;
  readonly reservationExecutionId: string | null;
  readonly reservationPrincipalId: string | null;
  readonly reservationCorrelationId: string | null;
  readonly reservedAt: string | null;
  readonly executingAt: string | null;
  readonly providerReadbackAt: string | null;
  readonly providerReadbackEvidence: readonly string[];
  readonly releasedAt: string | null;
  readonly releaseReason: string | null;
  readonly failedReviewAt: string | null;
  readonly failureReason: string | null;
  readonly status: ApprovalStatus;
  readonly evidence: readonly string[];
  readonly correlationId: string;
  readonly version: number;
}

export interface ApprovalRecordWire {
  readonly approval_id: string;
  readonly requester: string;
  readonly approver: string | null;
  readonly route_id: RouteId;
  readonly capability_id: string;
  readonly descriptor_sha256: string;
  readonly target_account: string;
  readonly scope: readonly string[];
  readonly financial_ceiling: ApprovalFinancialCeiling | null;
  readonly issued_at: string | null;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly reservation_execution_id: string | null;
  readonly reservation_principal_id: string | null;
  readonly reservation_correlation_id: string | null;
  readonly reserved_at: string | null;
  readonly executing_at: string | null;
  readonly provider_readback_at: string | null;
  readonly provider_readback_evidence: readonly string[];
  readonly released_at: string | null;
  readonly release_reason: string | null;
  readonly failed_review_at: string | null;
  readonly failure_reason: string | null;
  readonly status: ApprovalStatus;
  readonly evidence: readonly string[];
  readonly correlation_id: string;
  readonly version: number;
}

export interface ApprovalRequestInput {
  readonly requester: string;
  readonly routeId: RouteId;
  readonly capabilityId: string;
  readonly descriptor: unknown;
  readonly targetAccount: string;
  readonly scope: readonly string[];
  readonly financialCeiling?: ApprovalFinancialCeiling | null;
  readonly expiresAt: string;
  readonly evidence?: readonly string[];
  readonly correlationId: string;
}

export interface ApprovalAuthority {
  readonly approver: string;
  readonly allowedRouteIds: readonly RouteId[];
  readonly allowedCapabilityIds: readonly string[];
  readonly allowedTargetAccounts: readonly string[];
  readonly maxFinancialCeiling: ApprovalFinancialCeiling | null;
  readonly validatedAt: string;
  readonly evidence: readonly string[];
}

export interface ApprovalExpectation {
  readonly requester?: string;
  readonly routeId: RouteId;
  readonly capabilityId: string;
  readonly descriptorSha256: string;
  readonly targetAccount: string;
  readonly requiredScope: readonly string[];
  readonly financialAmountMinor?: number;
  readonly currency?: string;
}

export interface ApprovalVerification {
  readonly valid: boolean;
  readonly reasons: readonly string[];
}

export interface ApprovalExecutionBinding {
  readonly executionId: string;
  readonly principalId: string;
  readonly correlationId: string;
}

export type ApprovalAtomicTransition =
  | {
      readonly type: 'RESERVE';
      readonly expectation: ApprovalExpectation;
      readonly binding: ApprovalExecutionBinding;
      readonly now?: string;
    }
  | {
      readonly type: 'BEGIN_EXECUTION';
      readonly executionId: string;
      readonly evidence?: readonly string[];
      readonly now?: string;
    }
  | {
      readonly type: 'PROVIDER_READBACK';
      readonly executionId: string;
      readonly evidence: readonly string[];
      readonly now?: string;
    }
  | {
      readonly type: 'CONSUME';
      readonly executionId: string;
      readonly evidence: readonly string[];
      readonly now?: string;
    }
  | {
      readonly type: 'RELEASE';
      readonly executionId: string;
      readonly evidence: readonly string[];
      readonly reason: string;
      readonly now?: string;
    }
  | {
      readonly type: 'FAIL_REVIEW_REQUIRED';
      readonly executionId: string;
      readonly evidence: readonly string[];
      readonly reason: string;
      readonly now?: string;
    };

export interface ApprovalStore {
  put(record: ApprovalRecord, expectedVersion?: number): Promise<void>;
  get(approvalId: string): Promise<ApprovalRecord | undefined>;
  history(approvalId: string): Promise<readonly ApprovalRecord[]>;
  transition(approvalId: string, transition: ApprovalAtomicTransition): Promise<ApprovalRecord>;
}

export class InMemoryApprovalStore implements ApprovalStore {
  readonly #current = new Map<string, ApprovalRecord>();
  readonly #history = new Map<string, ApprovalRecord[]>();
  readonly #claimedExecutionIds = new Set<string>();

  put(record: ApprovalRecord, expectedVersion?: number): Promise<void> {
    return Promise.resolve().then(() => {
      if (DIRECT_PUT_FORBIDDEN_STATUSES.has(record.status))
        throw new Error('APPROVAL_EXECUTION_TRANSITION_REQUIRED');
      const current = this.#current.get(record.approvalId);
      if (expectedVersion !== undefined && current?.version !== expectedVersion)
        throw new Error('APPROVAL_VERSION_CONFLICT');
      if (current && record.version !== current.version + 1)
        throw new Error('APPROVAL_VERSION_SEQUENCE_INVALID');
      if (!current && record.version !== 1) throw new Error('APPROVAL_INITIAL_VERSION_INVALID');
      this.#persist(record);
    });
  }

  get(approvalId: string): Promise<ApprovalRecord | undefined> {
    return Promise.resolve(this.#current.get(approvalId));
  }

  history(approvalId: string): Promise<readonly ApprovalRecord[]> {
    return Promise.resolve(this.#history.get(approvalId) ?? []);
  }

  transition(approvalId: string, transition: ApprovalAtomicTransition): Promise<ApprovalRecord> {
    return Promise.resolve().then(() => {
      const current = this.#current.get(approvalId);
      if (!current) throw new Error('APPROVAL_NOT_FOUND');
      if (transition.type === 'RESERVE') {
        if (this.#claimedExecutionIds.has(transition.binding.executionId))
          throw new Error('APPROVAL_EXECUTION_ID_ALREADY_CLAIMED');
        this.#claimedExecutionIds.add(transition.binding.executionId);
      }
      const next = applyApprovalAtomicTransition(current, transition);
      this.#persist(next);
      return next;
    });
  }

  #persist(record: ApprovalRecord): void {
    this.#current.set(record.approvalId, record);
    this.#history.set(record.approvalId, [
      ...(this.#history.get(record.approvalId) ?? []),
      record,
    ]);
  }
}

export function requestApproval(
  input: ApprovalRequestInput,
  options: { readonly now?: string; readonly createId?: () => string } = {},
): ApprovalRecord {
  const now = options.now ?? new Date().toISOString();
  assertApprovalRequest(input, now);
  return {
    approvalId: options.createId?.() ?? randomUUID(),
    requester: input.requester,
    approver: null,
    routeId: input.routeId,
    capabilityId: input.capabilityId,
    descriptorSha256: hashApprovalDescriptor(input.descriptor),
    targetAccount: input.targetAccount,
    scope: unique(input.scope).sort(),
    financialCeiling: input.financialCeiling ?? null,
    requestedAt: now,
    issuedAt: null,
    expiresAt: input.expiresAt,
    consumedAt: null,
    revokedAt: null,
    reservationExecutionId: null,
    reservationPrincipalId: null,
    reservationCorrelationId: null,
    reservedAt: null,
    executingAt: null,
    providerReadbackAt: null,
    providerReadbackEvidence: [],
    releasedAt: null,
    releaseReason: null,
    failedReviewAt: null,
    failureReason: null,
    status: 'REQUESTED',
    evidence: unique(input.evidence ?? []).sort(),
    correlationId: input.correlationId,
    version: 1,
  };
}

export function issueApproval(
  record: ApprovalRecord,
  input: {
    readonly authority: ApprovalAuthority;
    readonly evidence: readonly string[];
    readonly now?: string;
  },
): ApprovalRecord {
  if (record.status !== 'REQUESTED') throw new Error('APPROVAL_NOT_REQUESTED');
  const now = input.now ?? new Date().toISOString();
  validateApproverAuthority(record, input.authority, now);
  requireEvidence(input.evidence, 'APPROVAL_EVIDENCE_REQUIRED');
  if (Date.parse(record.expiresAt) <= Date.parse(now)) throw new Error('APPROVAL_EXPIRED');
  return {
    ...record,
    approver: input.authority.approver,
    issuedAt: now,
    status: 'APPROVED',
    evidence: unique([...record.evidence, ...input.authority.evidence, ...input.evidence]).sort(),
    version: record.version + 1,
  };
}

export function validateApproverAuthority(
  record: ApprovalRecord,
  authority: ApprovalAuthority,
  now = new Date().toISOString(),
): void {
  if (!authority.approver.trim()) throw new Error('APPROVAL_APPROVER_REQUIRED');
  if (!Number.isFinite(Date.parse(authority.validatedAt)))
    throw new Error('APPROVAL_AUTHORITY_TIMESTAMP_INVALID');
  if (Date.parse(authority.validatedAt) > Date.parse(now))
    throw new Error('APPROVAL_AUTHORITY_FROM_FUTURE');
  requireEvidence(authority.evidence, 'APPROVAL_AUTHORITY_EVIDENCE_REQUIRED');
  if (!authority.allowedRouteIds.includes(record.routeId))
    throw new Error('APPROVAL_APPROVER_ROUTE_NOT_ALLOWED');
  if (!authority.allowedCapabilityIds.includes(record.capabilityId))
    throw new Error('APPROVAL_APPROVER_CAPABILITY_NOT_ALLOWED');
  if (!authority.allowedTargetAccounts.includes(record.targetAccount))
    throw new Error('APPROVAL_APPROVER_TARGET_NOT_ALLOWED');
  if (record.financialCeiling) {
    if (!authority.maxFinancialCeiling)
      throw new Error('APPROVAL_APPROVER_FINANCIAL_AUTHORITY_MISSING');
    if (authority.maxFinancialCeiling.currency !== record.financialCeiling.currency)
      throw new Error('APPROVAL_APPROVER_CURRENCY_NOT_ALLOWED');
    if (authority.maxFinancialCeiling.amountMinor < record.financialCeiling.amountMinor)
      throw new Error('APPROVAL_APPROVER_CEILING_EXCEEDED');
  }
}

export function verifyApproval(
  record: ApprovalRecord,
  expectation: ApprovalExpectation,
  now = new Date().toISOString(),
): ApprovalVerification {
  const reasons: string[] = [];
  if (!RESERVABLE_STATUSES.has(record.status)) reasons.push(`STATUS_${record.status}`);
  if (!record.approver || !record.issuedAt) reasons.push('NOT_ISSUED');
  if (Date.parse(record.expiresAt) <= Date.parse(now)) reasons.push('EXPIRED');
  if (expectation.requester && record.requester !== expectation.requester)
    reasons.push('REQUESTER_MISMATCH');
  if (record.routeId !== expectation.routeId) reasons.push('ROUTE_MISMATCH');
  if (record.capabilityId !== expectation.capabilityId) reasons.push('CAPABILITY_MISMATCH');
  if (record.descriptorSha256 !== expectation.descriptorSha256) reasons.push('DESCRIPTOR_MISMATCH');
  if (record.targetAccount !== expectation.targetAccount) reasons.push('TARGET_MISMATCH');
  if (expectation.requiredScope.some((scope) => !record.scope.includes(scope)))
    reasons.push('SCOPE_MISMATCH');
  if (expectation.financialAmountMinor !== undefined) {
    if (!record.financialCeiling) reasons.push('FINANCIAL_CEILING_MISSING');
    else {
      if (record.financialCeiling.amountMinor < expectation.financialAmountMinor)
        reasons.push('FINANCIAL_CEILING_EXCEEDED');
      if (
        expectation.currency &&
        record.financialCeiling.currency !== expectation.currency.toUpperCase()
      )
        reasons.push('CURRENCY_MISMATCH');
    }
  }
  return { valid: reasons.length === 0, reasons };
}

export function applyApprovalAtomicTransition(
  record: ApprovalRecord,
  transition: ApprovalAtomicTransition,
): ApprovalRecord {
  const now = transition.now ?? new Date().toISOString();

  switch (transition.type) {
    case 'RESERVE': {
      const verification = verifyApproval(record, transition.expectation, now);
      if (!verification.valid)
        throw new Error(`APPROVAL_VERIFICATION_FAILED:${verification.reasons.join(',')}`);
      const { executionId, principalId, correlationId } = transition.binding;
      requireNonEmpty(executionId, 'APPROVAL_EXECUTION_ID_REQUIRED');
      requireNonEmpty(principalId, 'APPROVAL_EXECUTION_PRINCIPAL_REQUIRED');
      requireNonEmpty(correlationId, 'APPROVAL_EXECUTION_CORRELATION_REQUIRED');
      if (transition.expectation.requester && transition.expectation.requester !== principalId)
        throw new Error('APPROVAL_EXECUTION_PRINCIPAL_MISMATCH');
      if (record.status === 'RELEASED' && record.reservationExecutionId === executionId)
        throw new Error('APPROVAL_EXECUTION_ID_ALREADY_CLAIMED');
      return {
        ...record,
        reservationExecutionId: executionId,
        reservationPrincipalId: principalId,
        reservationCorrelationId: correlationId,
        reservedAt: now,
        executingAt: null,
        providerReadbackAt: null,
        providerReadbackEvidence: [],
        consumedAt: null,
        releasedAt: null,
        releaseReason: null,
        failedReviewAt: null,
        failureReason: null,
        status: 'RESERVED',
        version: record.version + 1,
      };
    }
    case 'BEGIN_EXECUTION': {
      assertExecutionTransition(record, 'RESERVED', transition.executionId);
      if (Date.parse(record.expiresAt) <= Date.parse(now)) throw new Error('APPROVAL_EXPIRED');
      return {
        ...record,
        executingAt: now,
        status: 'EXECUTING',
        evidence: mergeEvidence(record.evidence, transition.evidence ?? []),
        version: record.version + 1,
      };
    }
    case 'PROVIDER_READBACK': {
      assertExecutionTransition(record, 'EXECUTING', transition.executionId);
      const evidence = requireEvidence(transition.evidence, 'APPROVAL_READBACK_EVIDENCE_REQUIRED');
      return {
        ...record,
        providerReadbackAt: now,
        providerReadbackEvidence: evidence,
        status: 'PROVIDER_READBACK',
        evidence: mergeEvidence(record.evidence, evidence),
        version: record.version + 1,
      };
    }
    case 'CONSUME': {
      assertExecutionTransition(record, 'PROVIDER_READBACK', transition.executionId);
      const evidence = requireEvidence(transition.evidence, 'APPROVAL_CONSUMPTION_EVIDENCE_REQUIRED');
      if (!record.providerReadbackAt || record.providerReadbackEvidence.length === 0)
        throw new Error('APPROVAL_PROVIDER_READBACK_REQUIRED');
      return {
        ...record,
        consumedAt: now,
        status: 'CONSUMED',
        evidence: mergeEvidence(record.evidence, evidence),
        version: record.version + 1,
      };
    }
    case 'RELEASE': {
      assertExecutionTransition(record, 'RESERVED', transition.executionId);
      const evidence = requireEvidence(transition.evidence, 'APPROVAL_RELEASE_EVIDENCE_REQUIRED');
      const reason = requireNonEmpty(transition.reason, 'APPROVAL_RELEASE_REASON_REQUIRED');
      return {
        ...record,
        releasedAt: now,
        releaseReason: reason,
        status: 'RELEASED',
        evidence: mergeEvidence(record.evidence, evidence),
        version: record.version + 1,
      };
    }
    case 'FAIL_REVIEW_REQUIRED': {
      if (!['EXECUTING', 'PROVIDER_READBACK'].includes(record.status))
        throw new Error(`APPROVAL_TRANSITION_INVALID:${record.status}->FAILED_REVIEW_REQUIRED`);
      assertExecutionId(record, transition.executionId);
      const evidence = requireEvidence(transition.evidence, 'APPROVAL_FAILURE_EVIDENCE_REQUIRED');
      const reason = requireNonEmpty(transition.reason, 'APPROVAL_FAILURE_REASON_REQUIRED');
      return {
        ...record,
        failedReviewAt: now,
        failureReason: reason,
        status: 'FAILED_REVIEW_REQUIRED',
        evidence: mergeEvidence(record.evidence, evidence),
        version: record.version + 1,
      };
    }
  }
}

/**
 * Compatibility helper for internal callers. Consumption is only valid after provider readback.
 */
export function consumeApproval(
  record: ApprovalRecord,
  executionId: string,
  evidence: readonly string[],
  now = new Date().toISOString(),
): ApprovalRecord {
  return applyApprovalAtomicTransition(record, {
    type: 'CONSUME',
    executionId,
    evidence,
    now,
  });
}

export function revokeApproval(
  record: ApprovalRecord,
  evidence: readonly string[],
  now = new Date().toISOString(),
): ApprovalRecord {
  if (!['REQUESTED', 'APPROVED', 'RELEASED'].includes(record.status))
    throw new Error('APPROVAL_NOT_REVOCABLE');
  requireEvidence(evidence, 'APPROVAL_REVOCATION_EVIDENCE_REQUIRED');
  return {
    ...record,
    status: 'REVOKED',
    revokedAt: now,
    evidence: mergeEvidence(record.evidence, evidence),
    version: record.version + 1,
  };
}

export function expireApproval(
  record: ApprovalRecord,
  now = new Date().toISOString(),
): ApprovalRecord {
  if (!['REQUESTED', 'APPROVED', 'RELEASED'].includes(record.status))
    throw new Error('APPROVAL_NOT_EXPIRABLE');
  if (Date.parse(record.expiresAt) > Date.parse(now)) throw new Error('APPROVAL_NOT_EXPIRED');
  return { ...record, status: 'EXPIRED', version: record.version + 1 };
}

export function hashApprovalDescriptor(descriptor: unknown): string {
  return createHash('sha256').update(stableJson(descriptor), 'utf8').digest('hex');
}

export function toApprovalRecordWire(record: ApprovalRecord): ApprovalRecordWire {
  return {
    approval_id: record.approvalId,
    requester: record.requester,
    approver: record.approver,
    route_id: record.routeId,
    capability_id: record.capabilityId,
    descriptor_sha256: record.descriptorSha256,
    target_account: record.targetAccount,
    scope: record.scope,
    financial_ceiling: record.financialCeiling,
    issued_at: record.issuedAt,
    expires_at: record.expiresAt,
    consumed_at: record.consumedAt,
    reservation_execution_id: record.reservationExecutionId,
    reservation_principal_id: record.reservationPrincipalId,
    reservation_correlation_id: record.reservationCorrelationId,
    reserved_at: record.reservedAt,
    executing_at: record.executingAt,
    provider_readback_at: record.providerReadbackAt,
    provider_readback_evidence: record.providerReadbackEvidence,
    released_at: record.releasedAt,
    release_reason: record.releaseReason,
    failed_review_at: record.failedReviewAt,
    failure_reason: record.failureReason,
    status: record.status,
    evidence: record.evidence,
    correlation_id: record.correlationId,
    version: record.version,
  };
}

export function normalizeApprovalRecord(record: Partial<ApprovalRecord> & ApprovalRecord): ApprovalRecord {
  return {
    ...record,
    reservationExecutionId: record.reservationExecutionId ?? null,
    reservationPrincipalId: record.reservationPrincipalId ?? null,
    reservationCorrelationId: record.reservationCorrelationId ?? null,
    reservedAt: record.reservedAt ?? null,
    executingAt: record.executingAt ?? null,
    providerReadbackAt: record.providerReadbackAt ?? null,
    providerReadbackEvidence: record.providerReadbackEvidence ?? [],
    releasedAt: record.releasedAt ?? null,
    releaseReason: record.releaseReason ?? null,
    failedReviewAt: record.failedReviewAt ?? null,
    failureReason: record.failureReason ?? null,
  };
}

export function isApprovalStatus(value: string): value is ApprovalStatus {
  return (APPROVAL_STATUSES as readonly string[]).includes(value);
}

export function isDirectApprovalPutAllowed(status: ApprovalStatus): boolean {
  return !DIRECT_PUT_FORBIDDEN_STATUSES.has(status);
}

function assertApprovalRequest(input: ApprovalRequestInput, now: string): void {
  if (!input.requester.trim()) throw new Error('APPROVAL_REQUESTER_REQUIRED');
  if (!isRouteId(input.routeId)) throw new Error('APPROVAL_ROUTE_INVALID');
  if (!input.capabilityId.trim()) throw new Error('APPROVAL_CAPABILITY_REQUIRED');
  const capability = getCapabilityDefinition(input.capabilityId);
  if (!capability) throw new Error('APPROVAL_CAPABILITY_UNKNOWN');
  const allowedRoutes = new Set<RouteId>();
  if (capability.route_id !== 'TRANSVERSAL') allowedRoutes.add(capability.route_id);
  if (capability.primary_route_id) allowedRoutes.add(capability.primary_route_id);
  for (const routeId of capability.consumer_route_ids) allowedRoutes.add(routeId);
  if (!allowedRoutes.has(input.routeId)) throw new Error('APPROVAL_CAPABILITY_ROUTE_MISMATCH');
  if (!input.targetAccount.trim()) throw new Error('APPROVAL_TARGET_REQUIRED');
  if (input.scope.length === 0 || input.scope.some((scope) => !scope.trim()))
    throw new Error('APPROVAL_SCOPE_REQUIRED');
  if (!input.correlationId.trim()) throw new Error('APPROVAL_CORRELATION_REQUIRED');
  requireEvidence(input.evidence ?? [], 'APPROVAL_REQUEST_EVIDENCE_REQUIRED');
  if (
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= Date.parse(now)
  )
    throw new Error('APPROVAL_EXPIRY_INVALID');
  if (input.financialCeiling) {
    if (
      !Number.isInteger(input.financialCeiling.amountMinor) ||
      input.financialCeiling.amountMinor < 0 ||
      !/^[A-Z]{3}$/.test(input.financialCeiling.currency)
    )
      throw new Error('APPROVAL_FINANCIAL_CEILING_INVALID');
  }
}

function assertExecutionTransition(
  record: ApprovalRecord,
  requiredStatus: ApprovalStatus,
  executionId: string,
): void {
  if (record.status !== requiredStatus)
    throw new Error(`APPROVAL_TRANSITION_INVALID:${record.status}->${requiredStatus}`);
  assertExecutionId(record, executionId);
}

function assertExecutionId(record: ApprovalRecord, executionId: string): void {
  if (!executionId.trim()) throw new Error('APPROVAL_EXECUTION_ID_REQUIRED');
  if (record.reservationExecutionId !== executionId)
    throw new Error('APPROVAL_EXECUTION_BINDING_MISMATCH');
}

function mergeEvidence(current: readonly string[], next: readonly string[]): readonly string[] {
  return unique([...current, ...next]).sort();
}

function requireEvidence(values: readonly string[], errorCode: string): readonly string[] {
  const evidence = unique(values.map((value) => value.trim()).filter(Boolean));
  if (evidence.length === 0) throw new Error(errorCode);
  return evidence;
}

function requireNonEmpty(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('APPROVAL_DESCRIPTOR_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('APPROVAL_DESCRIPTOR_INVALID');
}
