import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../src/core/audit.js';
import {
  AUDIT_GENESIS_HASH,
  canonicalAuditPayload,
  hashAuditPayload,
  normalizeAuditEvidence,
  verifyAuditLedger,
  type AuditLedgerHead,
  type AuditLedgerRecord,
} from '../src/core/audit-ledger.js';

const base: AuditEvent = {
  executionId: 'exec-1',
  correlationId: 'corr-1',
  toolName: 'system.health',
  requester: 'principal-1',
  principalType: 'SERVICE',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
  authenticationMethod: 'INFRASTRUCTURE_IDENTITY',
  authorizationRoles: ['OPERATOR'],
  status: 'STARTED',
  evidence: ['identity:service', 'policy:allowed'],
  createdAt: '2026-08-15T04:30:00.000Z',
};

function record(
  event: AuditEvent,
  sequence: number,
  previousHash: string,
  eventId: string,
): AuditLedgerRecord {
  const canonicalPayload = canonicalAuditPayload(event, 'READ', sequence, previousHash);
  return {
    ...event,
    eventId,
    riskClass: 'READ',
    sequence,
    previousHash,
    eventHash: hashAuditPayload(canonicalPayload),
    evidence: normalizeAuditEvidence(event),
    canonicalPayload,
  };
}

describe('M-FOUND-08 audit ledger integrity', () => {
  it('verifies a deterministic two-event hash chain against its head', () => {
    const started = record(base, 1, AUDIT_GENESIS_HASH, 'audit-1');
    const succeeded = record(
      {
        ...base,
        status: 'SUCCEEDED',
        createdAt: '2026-08-15T04:30:01.000Z',
        evidence: ['provider:readback:ok'],
      },
      2,
      started.eventHash,
      'audit-2',
    );
    const head: AuditLedgerHead = {
      executionId: base.executionId,
      correlationId: base.correlationId,
      tenantId: base.tenantId ?? null,
      lastSequence: 2,
      headHash: succeeded.eventHash,
      updatedAt: succeeded.createdAt,
    };

    expect(verifyAuditLedger(base.executionId, [started, succeeded], head)).toEqual({
      valid: true,
      executionId: base.executionId,
      recordCount: 2,
      lastSequence: 2,
      headHash: succeeded.eventHash,
      reason: null,
    });
  });

  it('detects tampering with a hashed audit field', () => {
    const started = record(base, 1, AUDIT_GENESIS_HASH, 'audit-1');
    const tampered: AuditLedgerRecord = { ...started, status: 'FAILED' };
    const head: AuditLedgerHead = {
      executionId: base.executionId,
      correlationId: base.correlationId,
      tenantId: base.tenantId ?? null,
      lastSequence: 1,
      headHash: started.eventHash,
      updatedAt: started.createdAt,
    };

    expect(verifyAuditLedger(base.executionId, [tampered], head).reason).toBe(
      'AUDIT_EVENT_HASH_MISMATCH',
    );
  });

  it('detects tampering with the persisted canonical payload', () => {
    const started = record(base, 1, AUDIT_GENESIS_HASH, 'audit-1');
    const tampered: AuditLedgerRecord = {
      ...started,
      canonicalPayload: {
        ...started.canonicalPayload,
        requester: 'attacker',
      },
    };
    const head: AuditLedgerHead = {
      executionId: base.executionId,
      correlationId: base.correlationId,
      tenantId: base.tenantId ?? null,
      lastSequence: 1,
      headHash: started.eventHash,
      updatedAt: started.createdAt,
    };

    expect(verifyAuditLedger(base.executionId, [tampered], head).reason).toBe(
      'AUDIT_CANONICAL_PAYLOAD_MISMATCH',
    );
  });

  it('detects sequence gaps and inconsistent heads', () => {
    const started = record(base, 1, AUDIT_GENESIS_HASH, 'audit-1');
    const invalidSequence: AuditLedgerRecord = { ...started, sequence: 2 };
    expect(
      verifyAuditLedger(base.executionId, [invalidSequence], {
        executionId: base.executionId,
        correlationId: base.correlationId,
        tenantId: base.tenantId ?? null,
        lastSequence: 2,
        headHash: started.eventHash,
        updatedAt: started.createdAt,
      }).reason,
    ).toBe('AUDIT_SEQUENCE_GAP');

    expect(
      verifyAuditLedger(base.executionId, [started], {
        executionId: base.executionId,
        correlationId: base.correlationId,
        tenantId: base.tenantId ?? null,
        lastSequence: 1,
        headHash: 'f'.repeat(64),
        updatedAt: started.createdAt,
      }).reason,
    ).toBe('AUDIT_HEAD_HASH_MISMATCH');
  });

  it('provides deterministic fallback evidence for legacy audit callers', () => {
    expect(
      normalizeAuditEvidence({
        executionId: base.executionId,
        correlationId: base.correlationId,
        toolName: base.toolName,
        requester: base.requester,
        status: base.status,
        createdAt: base.createdAt,
      }),
    ).toEqual(['audit:started:exec-1']);
  });
});
