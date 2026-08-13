import type pg from 'pg';
import {
  assertApprovedTocaManagedDescriptor,
  hashTocaManagedInstagramApprovalDescriptor,
  parseTocaManagedInstagramSchedulePayload,
} from '../scheduler/toca-managed-instagram-scheduler.js';
import type { ScheduledJob } from '../scheduler/scheduler-contracts.js';
import type { JobHandler } from './worker.js';

export class TocaManagedInstagramApprovalAuditGate implements JobHandler {
  constructor(
    private readonly pool: pg.Pool,
    private readonly delegate: JobHandler,
  ) {}

  async execute(payload: unknown, job: ScheduledJob): Promise<void> {
    let parsed;
    try {
      parsed = parseTocaManagedInstagramSchedulePayload(payload);
      assertApprovedTocaManagedDescriptor(parsed);
    } catch (error) {
      const normalized = normalizeError(error);
      await this.audit(job, undefined, 'DENIED', { error: normalized });
      throw error;
    }

    const descriptorSha256 = hashTocaManagedInstagramApprovalDescriptor(parsed);
    await this.audit(job, descriptorSha256, 'APPROVED', {
      approvalMode: parsed.approval.mode,
      contentItemId: parsed.contentItemId,
    });

    try {
      await this.delegate.execute(parsed, job);
      await this.audit(job, descriptorSha256, 'SUCCEEDED', { completed: true });
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized === 'INSTAGRAM_PUBLICATION_PROCESSING_PENDING') {
        await this.audit(job, descriptorSha256, 'PENDING', { processing: true });
      } else {
        await this.audit(job, descriptorSha256, 'FAILED', { error: normalized });
      }
      throw error;
    }
  }

  private async audit(
    job: ScheduledJob,
    descriptorSha256: string | undefined,
    decision: 'DENIED' | 'APPROVED' | 'PENDING' | 'SUCCEEDED' | 'FAILED',
    providerResult: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.pool.query(
      `insert into audit_events
         (correlation_id, tool_name, risk_class, decision, normalized_payload, provider_result)
       values ($1, $2, 'WRITE', $3, $4::jsonb, $5::jsonb)`,
      [
        correlationId(job.payload, job.id),
        'internal.instagram.publication.toca-managed.execute',
        decision,
        JSON.stringify({
          jobId: job.id,
          descriptorSha256: descriptorSha256 ?? null,
        }),
        JSON.stringify(providerResult),
      ],
    );
  }
}

function correlationId(payload: unknown, fallback: string): string {
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

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_PUBLICATION_ERROR';
}
