import { createHash } from 'node:crypto';
import type { AuditEvent } from './audit.js';
import type { RiskClass } from './tool-registry.js';

export const AUDIT_GENESIS_HASH = '0'.repeat(64);

export interface AuditLedgerRecord extends AuditEvent {
  readonly eventId: string;
  readonly riskClass: RiskClass;
  readonly sequence: number;
  readonly previousHash: string;
  readonly eventHash: string;
  readonly evidence: readonly string[];
  readonly canonicalPayload: Readonly<Record<string, unknown>>;
}

export interface AuditLedgerHead {
  readonly executionId: string;
  readonly correlationId: string;
  readonly tenantId: string | null;
  readonly lastSequence: number;
  readonly headHash: string;
  readonly updatedAt: string;
}

export interface AuditLedgerVerification {
  readonly valid: boolean;
  readonly executionId: string;
  readonly recordCount: number;
  readonly lastSequence: number;
  readonly headHash: string;
  readonly reason: string | null;
}

export interface AuditLedgerCanonicalInput {
  readonly executionId: string;
  readonly correlationId: string;
  readonly sequence: number;
  readonly previousHash: string;
  readonly requester: string;
  readonly principalType: AuditEvent['principalType'] | null;
  readonly tenantId: string | null;
  readonly workspaceId: string | null;
  readonly organizationId: string | null;
  readonly sessionId: string | null;
  readonly authenticationMethod: AuditEvent['authenticationMethod'] | null;
  readonly authorizationRoles: readonly string[];
  readonly toolName: string;
  readonly riskClass: RiskClass;
  readonly status: AuditEvent['status'];
  readonly approvalId: string | null;
  readonly connectedAccount: string | null;
  readonly externalResourceId: string | null;
  readonly errorCode: string | null;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export function canonicalAuditPayload(
  event: AuditEvent,
  riskClass: RiskClass,
  sequence: number,
  previousHash: string,
): Readonly<Record<string, unknown>> {
  assertAuditSequence(sequence);
  assertAuditHash(previousHash, 'AUDIT_PREVIOUS_HASH_INVALID');
  const evidence = normalizeAuditEvidence(event);
  const input: AuditLedgerCanonicalInput = {
    executionId: requireText(event.executionId, 'AUDIT_EXECUTION_ID_REQUIRED'),
    correlationId: requireText(event.correlationId, 'AUDIT_CORRELATION_ID_REQUIRED'),
    sequence,
    previousHash,
    requester: requireText(event.requester, 'AUDIT_REQUESTER_REQUIRED'),
    principalType: event.principalType ?? null,
    tenantId: nullableText(event.tenantId),
    workspaceId: nullableText(event.workspaceId),
    organizationId: nullableText(event.organizationId),
    sessionId: nullableText(event.sessionId),
    authenticationMethod: event.authenticationMethod ?? null,
    authorizationRoles: [...new Set(event.authorizationRoles ?? [])].sort(),
    toolName: requireText(event.toolName, 'AUDIT_TOOL_NAME_REQUIRED'),
    riskClass,
    status: event.status,
    approvalId: nullableText(event.approvalId),
    connectedAccount: nullableText(event.connectedAccount),
    externalResourceId: nullableText(event.externalResourceId),
    errorCode: nullableText(event.errorCode),
    evidence,
    createdAt: assertTimestamp(event.createdAt),
  };
  return canonicalize(input) as Readonly<Record<string, unknown>>;
}

export function hashAuditPayload(payload: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

export function normalizeAuditEvidence(event: AuditEvent): readonly string[] {
  const evidence = [
    ...new Set((event.evidence ?? []).map((item) => item.trim()).filter(Boolean)),
  ].sort();
  return evidence.length > 0
    ? evidence
    : [
        `audit:${event.status.toLowerCase()}:${requireText(event.executionId, 'AUDIT_EXECUTION_ID_REQUIRED')}`,
      ];
}

export function verifyAuditLedger(
  executionId: string,
  records: readonly AuditLedgerRecord[],
  head: AuditLedgerHead | undefined,
): AuditLedgerVerification {
  requireText(executionId, 'AUDIT_EXECUTION_ID_REQUIRED');
  if (records.length === 0) {
    return {
      valid: head === undefined,
      executionId,
      recordCount: 0,
      lastSequence: 0,
      headHash: AUDIT_GENESIS_HASH,
      reason: head ? 'AUDIT_HEAD_WITHOUT_RECORDS' : null,
    };
  }

  let previousHash = AUDIT_GENESIS_HASH;
  let expectedSequence = 1;
  for (const record of records) {
    if (record.executionId !== executionId)
      return invalid(executionId, records, previousHash, 'AUDIT_EXECUTION_MISMATCH');
    if (record.sequence !== expectedSequence)
      return invalid(executionId, records, previousHash, 'AUDIT_SEQUENCE_GAP');
    if (record.previousHash !== previousHash)
      return invalid(executionId, records, previousHash, 'AUDIT_PREVIOUS_HASH_MISMATCH');
    const expectedPayload = canonicalAuditPayload(
      record,
      record.riskClass,
      record.sequence,
      record.previousHash,
    );
    if (canonicalJson(record.canonicalPayload) !== canonicalJson(expectedPayload)) {
      return invalid(executionId, records, previousHash, 'AUDIT_CANONICAL_PAYLOAD_MISMATCH');
    }
    const expectedHash = hashAuditPayload(expectedPayload);
    if (record.eventHash !== expectedHash)
      return invalid(executionId, records, previousHash, 'AUDIT_EVENT_HASH_MISMATCH');
    previousHash = expectedHash;
    expectedSequence += 1;
  }

  const lastSequence = records.length;
  if (!head) return invalid(executionId, records, previousHash, 'AUDIT_HEAD_MISSING');
  if (head.executionId !== executionId)
    return invalid(executionId, records, previousHash, 'AUDIT_HEAD_EXECUTION_MISMATCH');
  if (head.lastSequence !== lastSequence)
    return invalid(executionId, records, previousHash, 'AUDIT_HEAD_SEQUENCE_MISMATCH');
  if (head.headHash !== previousHash)
    return invalid(executionId, records, previousHash, 'AUDIT_HEAD_HASH_MISMATCH');

  return {
    valid: true,
    executionId,
    recordCount: records.length,
    lastSequence,
    headHash: previousHash,
    reason: null,
  };
}

function invalid(
  executionId: string,
  records: readonly AuditLedgerRecord[],
  headHash: string,
  reason: string,
): AuditLedgerVerification {
  return {
    valid: false,
    executionId,
    recordCount: records.length,
    lastSequence: records.length,
    headHash,
    reason,
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function assertAuditSequence(sequence: number): void {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('AUDIT_SEQUENCE_INVALID');
}

function assertAuditHash(value: string, errorCode: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(errorCode);
}

function assertTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error('AUDIT_CREATED_AT_INVALID');
  return new Date(value).toISOString();
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function nullableText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
