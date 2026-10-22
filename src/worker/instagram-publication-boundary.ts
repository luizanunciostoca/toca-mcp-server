import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { ScheduledJob } from '../scheduler/scheduler-contracts.js';
import type { JobHandler } from './worker.js';

export class InstagramPublicationApprovalAuditGate implements JobHandler {
  constructor(
    private readonly pool: pg.Pool,
    private readonly approvedRequestSha256: string | undefined,
    private readonly delegate: JobHandler,
  ) {}

  async execute(payload: unknown, job: ScheduledJob): Promise<void> {
    const requestSnapshot = snapshotApprovalPayload(payload);
    const jobSnapshot = { ...job, payload: requestSnapshot };
    const requestSha256 = hashInstagramPublicationApprovalPayload(requestSnapshot);
    const auditContext = {
      jobId: jobSnapshot.id,
      correlationId: publicationCorrelationId(requestSnapshot, jobSnapshot.id),
    };

    if (!this.approvedRequestSha256) {
      await this.audit(auditContext, requestSha256, 'DENIED', { reason: 'APPROVAL_REQUIRED' });
      throw new Error('INSTAGRAM_PUBLICATION_APPROVAL_REQUIRED');
    }

    if (requestSha256 !== this.approvedRequestSha256) {
      await this.audit(auditContext, requestSha256, 'DENIED', { reason: 'APPROVAL_MISMATCH' });
      throw new Error('INSTAGRAM_PUBLICATION_APPROVAL_MISMATCH');
    }

    await this.audit(auditContext, requestSha256, 'APPROVED', { approved: true });

    try {
      await this.delegate.execute(requestSnapshot, jobSnapshot);
      await this.audit(auditContext, requestSha256, 'SUCCEEDED', { completed: true });
    } catch (error) {
      const normalized = error instanceof Error ? error.message : 'UNKNOWN_PUBLICATION_ERROR';
      if (normalized === 'INSTAGRAM_PUBLICATION_PROCESSING_PENDING') {
        await this.audit(auditContext, requestSha256, 'PENDING', { processing: true });
      } else {
        await this.audit(auditContext, requestSha256, 'FAILED', { error: normalized });
      }
      throw error;
    }
  }

  private async audit(
    context: { readonly jobId: string; readonly correlationId: string },
    requestSha256: string,
    decision: 'DENIED' | 'APPROVED' | 'PENDING' | 'SUCCEEDED' | 'FAILED',
    providerResult: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.pool.query(
      `insert into audit_events
         (correlation_id, tool_name, risk_class, decision, normalized_payload, provider_result)
       values ($1, $2, 'WRITE', $3, $4::jsonb, $5::jsonb)`,
      [
        context.correlationId,
        'internal.instagram.publication.execute',
        decision,
        JSON.stringify({
          jobId: context.jobId,
          requestSha256,
          approvedRequestSha256Configured: Boolean(this.approvedRequestSha256),
        }),
        JSON.stringify(providerResult),
      ],
    );
  }
}

export function hashInstagramPublicationApprovalPayload(payload: unknown): string {
  return createHash('sha256').update(stableJson(payload), 'utf8').digest('hex');
}

function snapshotApprovalPayload(value: unknown): unknown {
  // Copy the same enumerable graph that stableJson hashes without JSON round-tripping:
  // undefined array entries and unsupported primitives must still fail validation.
  if (Array.isArray(value)) {
    const snapshot = new Array<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      if (index in value) snapshot[index] = snapshotApprovalPayload(value[index]);
    }
    return snapshot;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).map((key) => [key, snapshotApprovalPayload(record[key])]),
    );
  }
  return value;
}

function publicationCorrelationId(payload: unknown, fallback: string): string {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'correlationId' in payload &&
    typeof payload.correlationId === 'string' &&
    payload.correlationId.length > 0
  ) {
    return payload.correlationId;
  }
  return fallback;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('INSTAGRAM_PUBLICATION_APPROVAL_PAYLOAD_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error('INSTAGRAM_PUBLICATION_APPROVAL_PAYLOAD_INVALID');
}
