import { createHash, randomUUID } from 'node:crypto';
import { getCapabilityDefinition } from './capability-catalog.js';
import { isRouteId, type RouteId } from './types.js';

export const APPROVAL_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'CONSUMED',
  'REVOKED',
  'EXPIRED',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

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
  readonly status: ApprovalStatus;
  readonly evidence: readonly string[];
  readonly correlation_id: string;
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

export interface ApprovalStore {
  put(record: ApprovalRecord, expectedVersion?: number): Promise<void>;
  get(approvalId: string): Promise<ApprovalRecord | undefined>;
  history(approvalId: string): Promise<readonly ApprovalRecord[]>;
}

export class InMemoryApprovalStore implements ApprovalStore {
  readonly #current = new Map<string, ApprovalRecord>();
  readonly #history = new Map<string, ApprovalRecord[]>();

  put(record: ApprovalRecord, expectedVersion?: number): Promise<void> {
    return Promise.resolve().then(() => {
      const current = this.#current.get(record.approvalId);
      if (expectedVersion !== undefined && current?.version !== expectedVersion)
        throw new Error('APPROVAL_VERSION_CONFLICT');
      if (current && record.version !== current.version + 1)
        throw new Error('APPROVAL_VERSION_SEQUENCE_INVALID');
      if (!current && record.version !== 1) throw new Error('APPROVAL_INITIAL_VERSION_INVALID');
      this.#current.set(record.approvalId, record);
      this.#history.set(record.approvalId, [
        ...(this.#history.get(record.approvalId) ?? []),
        record,
      ]);
    });
  }

  get(approvalId: string): Promise<ApprovalRecord | undefined> {
    return Promise.resolve(this.#current.get(approvalId));
  }

  history(approvalId: string): Promise<readonly ApprovalRecord[]> {
    return Promise.resolve(this.#history.get(approvalId) ?? []);
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
    scope: [...new Set(input.scope)].sort(),
    financialCeiling: input.financialCeiling ?? null,
    requestedAt: now,
    issuedAt: null,
    expiresAt: input.expiresAt,
    consumedAt: null,
    revokedAt: null,
    status: 'REQUESTED',
    evidence: [...new Set(input.evidence ?? [])].sort(),
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
  if (input.evidence.length === 0) throw new Error('APPROVAL_EVIDENCE_REQUIRED');
  if (Date.parse(record.expiresAt) <= Date.parse(now)) throw new Error('APPROVAL_EXPIRED');
  return {
    ...record,
    approver: input.authority.approver,
    issuedAt: now,
    status: 'APPROVED',
    evidence: [
      ...new Set([...record.evidence, ...input.authority.evidence, ...input.evidence]),
    ].sort(),
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
  if (authority.evidence.length === 0) throw new Error('APPROVAL_AUTHORITY_EVIDENCE_REQUIRED');
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
  if (record.status !== 'APPROVED') reasons.push(`STATUS_${record.status}`);
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

export function consumeApproval(
  record: ApprovalRecord,
  expectation: ApprovalExpectation,
  now = new Date().toISOString(),
): ApprovalRecord {
  const verification = verifyApproval(record, expectation, now);
  if (!verification.valid)
    throw new Error(`APPROVAL_VERIFICATION_FAILED:${verification.reasons.join(',')}`);
  return { ...record, status: 'CONSUMED', consumedAt: now, version: record.version + 1 };
}

export function revokeApproval(
  record: ApprovalRecord,
  evidence: readonly string[],
  now = new Date().toISOString(),
): ApprovalRecord {
  if (!['REQUESTED', 'APPROVED'].includes(record.status)) throw new Error('APPROVAL_NOT_REVOCABLE');
  if (evidence.length === 0) throw new Error('APPROVAL_REVOCATION_EVIDENCE_REQUIRED');
  return {
    ...record,
    status: 'REVOKED',
    revokedAt: now,
    evidence: [...new Set([...record.evidence, ...evidence])].sort(),
    version: record.version + 1,
  };
}

export function expireApproval(
  record: ApprovalRecord,
  now = new Date().toISOString(),
): ApprovalRecord {
  if (!['REQUESTED', 'APPROVED'].includes(record.status)) throw new Error('APPROVAL_NOT_EXPIRABLE');
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
    status: record.status,
    evidence: record.evidence,
    correlation_id: record.correlationId,
  };
}

function assertApprovalRequest(input: ApprovalRequestInput, now: string): void {
  if (!input.requester.trim()) throw new Error('APPROVAL_REQUESTER_REQUIRED');
  if (!isRouteId(input.routeId)) throw new Error('APPROVAL_ROUTE_INVALID');
  if (!input.capabilityId.trim()) throw new Error('APPROVAL_CAPABILITY_REQUIRED');
  const capability = getCapabilityDefinition(input.capabilityId);
  if (!capability) throw new Error('APPROVAL_CAPABILITY_UNKNOWN');
  if (capability.route_id !== input.routeId) throw new Error('APPROVAL_CAPABILITY_ROUTE_MISMATCH');
  if (!input.targetAccount.trim()) throw new Error('APPROVAL_TARGET_REQUIRED');
  if (input.scope.length === 0 || input.scope.some((scope) => !scope.trim()))
    throw new Error('APPROVAL_SCOPE_REQUIRED');
  if (!input.correlationId.trim()) throw new Error('APPROVAL_CORRELATION_REQUIRED');
  if (!input.evidence || input.evidence.length === 0)
    throw new Error('APPROVAL_REQUEST_EVIDENCE_REQUIRED');
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
