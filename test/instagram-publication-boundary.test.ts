import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { ScheduledJob } from '../src/scheduler/scheduler-contracts.js';
import {
  hashInstagramPublicationApprovalPayload,
  InstagramPublicationApprovalAuditGate,
} from '../src/worker/instagram-publication-boundary.js';
import type { JobHandler } from '../src/worker/worker.js';

const payload = {
  account: { pageId: 'page-1', instagramAccountId: 'ig-1' },
  mediaType: 'IMAGE',
  mediaUrls: ['https://example.com/image.jpg'],
  caption: 'Controlled publication',
  correlationId: 'corr-1',
  idempotencyKey: 'idem-1',
};

const job: ScheduledJob = {
  id: 'job-1',
  toolName: 'internal.instagram.publication.execute',
  payload,
  runAt: '2026-08-12T18:00:00.000Z',
  timezone: 'America/Bahia',
  idempotencyKey: 'internal:instagram:publication:idem-1',
  status: 'RUNNING',
  attempts: 1,
};

function createGate(approvedRequestSha256?: string) {
  const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
  const execute = vi.fn().mockResolvedValue(undefined);
  const pool = { query } as unknown as pg.Pool;
  const delegate = { execute } as JobHandler;
  const gate = new InstagramPublicationApprovalAuditGate(pool, approvedRequestSha256, delegate);
  return { gate, query, execute };
}

describe('Instagram publication approval and audit boundary', () => {
  it('hashes object keys deterministically', () => {
    const reordered = {
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      caption: 'Controlled publication',
      mediaUrls: ['https://example.com/image.jpg'],
      mediaType: 'IMAGE',
      account: { instagramAccountId: 'ig-1', pageId: 'page-1' },
    };

    expect(hashInstagramPublicationApprovalPayload(reordered)).toBe(
      hashInstagramPublicationApprovalPayload(payload),
    );
  });

  it('fails closed and audits when approval is missing', async () => {
    const { gate, query, execute } = createGate();

    await expect(gate.execute(payload, job)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_APPROVAL_REQUIRED',
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed and audits when the approved hash differs', async () => {
    const { gate, query, execute } = createGate('a'.repeat(64));

    await expect(gate.execute(payload, job)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_APPROVAL_MISMATCH',
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('audits approval and success around exactly approved execution', async () => {
    const approved = hashInstagramPublicationApprovalPayload(payload);
    const { gate, query, execute } = createGate(approved);

    await gate.execute(payload, job);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(['corr-1', 'internal.instagram.publication.execute', 'APPROVED']),
    );
    expect(query.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(['corr-1', 'internal.instagram.publication.execute', 'SUCCEEDED']),
    );
  });
});
