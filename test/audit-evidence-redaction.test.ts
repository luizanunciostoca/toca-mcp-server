import { describe, expect, it } from 'vitest';
import { InMemoryAuditSink, type AuditEvent } from '../src/core/audit.js';
import {
  AUDIT_GENESIS_HASH,
  hashAuditPayload,
  normalizeAuditEvidence,
  verifyAuditLedger,
  type AuditLedgerHead,
  type AuditLedgerRecord,
} from '../src/core/audit-ledger.js';

const base: AuditEvent = {
  executionId: 'exec-redaction-1',
  correlationId: 'corr-redaction-1',
  toolName: 'system.health',
  requester: 'principal-1',
  principalType: 'SERVICE',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
  authenticationMethod: 'INFRASTRUCTURE_IDENTITY',
  authorizationRoles: ['OPERATOR'],
  status: 'STARTED',
  createdAt: '2026-08-22T17:40:00.000Z',
};

describe('audit evidence redaction', () => {
  it('keeps opaque evidence refs and hashes direct PII or unstructured values', async () => {
    const directEmail = ['guest', 'example.com'].join('@');
    const directPhone = ['phone:', '+55', '11999999999'].join('');
    const unstructuredValue = ['credential', 'synthetic-value'].join(' ');
    const event: AuditEvent = {
      ...base,
      evidence: ['provider:readback:verified', directEmail, directPhone, unstructuredValue],
    };

    const normalized = normalizeAuditEvidence(event);
    expect(normalized).toContain('provider:readback:verified');
    expect(normalized.filter((item) => item.startsWith('audit:redacted:sha256:'))).toHaveLength(3);
    expect(JSON.stringify(normalized)).not.toContain(directEmail);
    expect(JSON.stringify(normalized)).not.toContain(directPhone);
    expect(JSON.stringify(normalized)).not.toContain(unstructuredValue);

    const sink = new InMemoryAuditSink();
    await sink.write(event);
    const persisted = JSON.stringify(sink.list());
    expect(persisted).not.toContain(directEmail);
    expect(persisted).not.toContain(directPhone);
    expect(persisted).not.toContain(unstructuredValue);
    expect(persisted).toContain('audit:redacted:sha256:');
  });

  it('continues to verify legacy hash-chain records that predate evidence redaction', () => {
    const legacyEvidence = 'legacy evidence with spaces';
    const event: AuditEvent = {
      ...base,
      executionId: 'exec-legacy-1',
      correlationId: 'corr-legacy-1',
      evidence: [legacyEvidence],
    };
    const canonicalPayload = {
      executionId: event.executionId,
      correlationId: event.correlationId,
      sequence: 1,
      previousHash: AUDIT_GENESIS_HASH,
      requester: event.requester,
      principalType: event.principalType ?? null,
      tenantId: event.tenantId ?? null,
      workspaceId: event.workspaceId ?? null,
      organizationId: event.organizationId ?? null,
      sessionId: event.sessionId ?? null,
      authenticationMethod: event.authenticationMethod ?? null,
      authorizationRoles: event.authorizationRoles ?? [],
      toolName: event.toolName,
      riskClass: 'READ' as const,
      status: event.status,
      approvalId: event.approvalId ?? null,
      connectedAccount: event.connectedAccount ?? null,
      externalResourceId: event.externalResourceId ?? null,
      errorCode: event.errorCode ?? null,
      evidence: [legacyEvidence],
      createdAt: event.createdAt,
    };
    const eventHash = hashAuditPayload(canonicalPayload);
    const record: AuditLedgerRecord = {
      ...event,
      eventId: 'audit-legacy-1',
      riskClass: 'READ',
      sequence: 1,
      previousHash: AUDIT_GENESIS_HASH,
      eventHash,
      evidence: [legacyEvidence],
      canonicalPayload,
    };
    const head: AuditLedgerHead = {
      executionId: event.executionId,
      correlationId: event.correlationId,
      tenantId: event.tenantId ?? null,
      lastSequence: 1,
      headHash: eventHash,
      updatedAt: event.createdAt,
    };

    expect(verifyAuditLedger(event.executionId, [record], head)).toMatchObject({
      valid: true,
      reason: null,
      recordCount: 1,
    });
  });
});
