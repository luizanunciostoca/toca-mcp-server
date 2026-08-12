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
    const requestSha256 = hashInstagramPublicationApprovalPayload(payload);

    if (!this.approvedRequestSha256) {
      await this.audit(job, requestSha256, 'DENIED', { reason: 'APPROVAL_REQUIRED' });
      throw new Error('INSTAGRAM_PUBLICATION_APPROVAL_REQUIRED');
    }

    if (requestSha256 !== this.approvedRequestSha256) {
      await this.audit(job, requestSha256, 'DENIED', { reason: 'APPROVAL_MISMATCH' });
      throw new Error('INSTAGRAM_PUBLICATION_APPROVAL_MISMATCH');
    }

    await this.audit(job, requestSha256, 'APPROVED', { approved: true });

    try {
      await this.delegate.execute(payload, job);
      await this.audit(job, requestSha256, 'SUCCEEDED', { completed: true });
    } catch (error) {
      await this.audit(job, requestSha256, 'FAILED', {
        error: error instanceof Error ? error.message : 'UNKNOWN_PUBLICATION_ERROR',
      });
      throw error;
    }
  }

  private async audit(
    job: ScheduledJob,
    requestSha256: string,
    decision: 'DENIED' | 'APPROVED' | 'SUCCEEDED' | 'FAILED',
    providerResult: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.pool.query(
      `insert into audit_events
         (correlation_id, tool_name, risk_class, decision, normalized_payload, provider_result)
       values ($1, $2, 'WRITE', $3, $4::jsonb, $5::jsonb)`,
      [
        publicationCorrelationId(job.payload, job.id),
        'internal.instagram.publication.execute',
        decision,
        JSON.stringify({
          jobId: job.id,
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
