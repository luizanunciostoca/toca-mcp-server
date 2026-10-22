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

  it.each([
    { outcome: 'success', error: undefined, decision: 'SUCCEEDED' },
    {
      outcome: 'pending processing',
      error: 'INSTAGRAM_PUBLICATION_PROCESSING_PENDING',
      decision: 'PENDING',
    },
    { outcome: 'failure', error: 'PROVIDER_REJECTED', decision: 'FAILED' },
  ])(
    'keeps the approved request and audit identity isolated through delayed audit and $outcome',
    async ({ error, decision }) => {
      const request = {
        ...payload,
        account: { ...payload.account },
        mediaUrls: [...payload.mediaUrls],
        oneOff: {
          mode: 'ONE_OFF',
          authorizationRef: 'approval-reference',
          authorizationId: 'approval-id',
          commandEnvelopeSha256: 'a'.repeat(64),
          validFrom: '2026-08-12T17:00:00.000Z',
          validUntil: '2026-08-12T19:00:00.000Z',
          maxPublications: 1,
        },
      };
      const expectedRequest = structuredClone(request);
      const callerJob = { ...job, payload: request };
      const approved = hashInstagramPublicationApprovalPayload(request);
      const { gate, query, execute } = createGate(approved);
      let finishApprovalAudit: () => void = () => {
        throw new Error('APPROVAL_AUDIT_NOT_STARTED');
      };
      query.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishApprovalAudit = () => resolve({ rowCount: 1, rows: [] });
          }),
      );
      if (error) execute.mockRejectedValueOnce(new Error(error));

      const execution = gate.execute(request, callerJob);
      expect(query).toHaveBeenCalledTimes(1);
      expect(execute).not.toHaveBeenCalled();

      request.account.pageId = 'unapproved-page';
      request.account.instagramAccountId = 'unapproved-account';
      request.mediaUrls[0] = 'https://example.com/unapproved.jpg';
      request.mediaUrls.push('https://example.com/extra.jpg');
      request.oneOff.authorizationRef = 'unapproved-reference';
      request.oneOff.authorizationId = 'unapproved-id';
      request.oneOff.commandEnvelopeSha256 = 'b'.repeat(64);
      request.oneOff.validUntil = '2027-08-12T19:00:00.000Z';
      request.oneOff.maxPublications = 2;
      request.correlationId = 'unapproved-correlation';
      request.idempotencyKey = 'unapproved-idempotency';
      callerJob.id = 'unapproved-job';
      callerJob.payload = { ...request, correlationId: 'replaced-job-correlation' };
      finishApprovalAudit();

      if (error) {
        await expect(execution).rejects.toThrow(error);
      } else {
        await expect(execution).resolves.toBeUndefined();
      }
      expect(execute).toHaveBeenCalledTimes(1);
      const delegatedPayload: unknown = execute.mock.calls[0]?.[0];
      const delegatedJob = execute.mock.calls[0]?.[1] as ScheduledJob;
      expect(delegatedPayload).toEqual(expectedRequest);
      expect(delegatedPayload).not.toBe(request);
      expect(delegatedJob).not.toBe(callerJob);
      expect(delegatedJob).toEqual({ ...job, payload: expectedRequest });
      expect(delegatedJob.payload).toBe(delegatedPayload);
      expect(hashInstagramPublicationApprovalPayload(delegatedPayload)).toBe(approved);
      expect(hashInstagramPublicationApprovalPayload(request)).not.toBe(approved);
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls.map((call) => (call[1] as unknown[])[2])).toEqual([
        'APPROVED',
        decision,
      ]);
      for (const call of query.mock.calls) {
        const parameters = call[1] as unknown[];
        expect(parameters[0]).toBe('corr-1');
        expect(parameters[3]).toBe(
          JSON.stringify({
            jobId: 'job-1',
            requestSha256: approved,
            approvedRequestSha256Configured: true,
          }),
        );
      }
    },
  );

  it('uses the hashed request correlation instead of unrelated job payload metadata', async () => {
    const approved = hashInstagramPublicationApprovalPayload(payload);
    const { gate, query, execute } = createGate(approved);

    await gate.execute(payload, { ...job, payload: { correlationId: 'unapproved-correlation' } });

    expect(query.mock.calls.map((call) => (call[1] as unknown[])[0])).toEqual(['corr-1', 'corr-1']);
    expect(execute).toHaveBeenCalledWith(payload, job);
  });

  it('hashes only the isolated values instead of rereading caller accessors', async () => {
    let accountReads = 0;
    const request = {
      ...payload,
      get account() {
        accountReads += 1;
        return accountReads === 1
          ? payload.account
          : { pageId: 'unapproved-page', instagramAccountId: 'unapproved-account' };
      },
    };
    const { gate, execute } = createGate(hashInstagramPublicationApprovalPayload(payload));

    await gate.execute(request, { ...job, payload: request });

    expect(accountReads).toBe(1);
    expect(execute).toHaveBeenCalledWith(payload, job);
  });

  it('still fails closed if the approval audit cannot be written', async () => {
    const { gate, query, execute } = createGate(hashInstagramPublicationApprovalPayload(payload));
    query.mockRejectedValueOnce(new Error('AUDIT_UNAVAILABLE'));

    await expect(gate.execute(payload, job)).rejects.toThrow('AUDIT_UNAVAILABLE');

    expect(query).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('retains job ID correlation fallback when the hashed payload has no correlation', async () => {
    const request = { ...payload, correlationId: undefined };
    const { gate, query } = createGate(hashInstagramPublicationApprovalPayload(request));

    await gate.execute(request, { ...job, payload: request });

    expect(query.mock.calls.map((call) => (call[1] as unknown[])[0])).toEqual(['job-1', 'job-1']);
  });

  it.each([undefined, 'a'.repeat(64)])(
    'does not use caller approval flags in place of external approval %s',
    async (configuredApproval) => {
      const request = {
        ...payload,
        approved: true,
        approvedRequestSha256: hashInstagramPublicationApprovalPayload(payload),
      };
      const { gate, execute } = createGate(configuredApproval);
      await expect(gate.execute(request, { ...job, payload: request })).rejects.toThrow(
        configuredApproval
          ? 'INSTAGRAM_PUBLICATION_APPROVAL_MISMATCH'
          : 'INSTAGRAM_PUBLICATION_APPROVAL_REQUIRED',
      );
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('preserves ignored undefined record properties and sparse array hash semantics', async () => {
    const sparse: unknown[] = [];
    sparse.length = 3;
    sparse[1] = { ignored: undefined, nested: 'preserved' };
    const request = { ...payload, ignored: undefined, nested: { sparse } };
    const approved = hashInstagramPublicationApprovalPayload(request);
    const { gate, execute } = createGate(approved);

    await gate.execute(request, { ...job, payload: request });

    const delegatedPayload = execute.mock.calls[0]?.[0] as typeof request;
    expect(delegatedPayload).toStrictEqual(request);
    expect(delegatedPayload.nested).not.toBe(request.nested);
    expect(delegatedPayload.nested.sparse).not.toBe(sparse);
    expect(delegatedPayload.nested.sparse[1]).not.toBe(sparse[1]);
    expect(Object.hasOwn(delegatedPayload, 'ignored')).toBe(true);
    expect(Object.hasOwn(delegatedPayload.nested.sparse, 0)).toBe(false);
    expect(Object.hasOwn(delegatedPayload.nested.sparse, 2)).toBe(false);
    expect(hashInstagramPublicationApprovalPayload(delegatedPayload)).toBe(approved);
  });

  it.each([
    ['NaN', { invalid: Number.NaN }],
    ['positive infinity', { invalid: Number.POSITIVE_INFINITY }],
    ['negative infinity', { invalid: Number.NEGATIVE_INFINITY }],
    ['function property', { invalid: () => 'not-a-payload' }],
    ['symbol property', { invalid: Symbol('not-a-payload') }],
    ['bigint property', { invalid: 1n }],
    ['undefined array item', { invalid: [undefined] }],
    ['function array item', { invalid: [() => 'not-a-payload'] }],
    ['symbol array item', { invalid: [Symbol('not-a-payload')] }],
  ])('does not normalize invalid %s into an approvable request', async (_name, extra) => {
    const request = { ...payload, ...extra };
    const { gate, query, execute } = createGate(hashInstagramPublicationApprovalPayload(payload));

    expect(() => hashInstagramPublicationApprovalPayload(request)).toThrow(
      'INSTAGRAM_PUBLICATION_APPROVAL_PAYLOAD_INVALID',
    );
    await expect(gate.execute(request, { ...job, payload: request })).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_APPROVAL_PAYLOAD_INVALID',
    );
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
