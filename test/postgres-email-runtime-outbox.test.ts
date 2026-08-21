import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import type {
  DomainEventEnvelope,
  TransactionalOutboxWriter,
} from '../src/events/transactional-outbox.js';
import type { EmailDispatchRecord } from '../src/omnichannel/email-runtime.js';
import { PostgresEmailRuntimeStore } from '../src/persistence/postgres-email-runtime-store.js';

const dispatch: EmailDispatchRecord = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
  dispatchId: 'dispatch-1',
  messageId: 'message-1',
  idempotencyKey: 'idem-1',
  provider: 'twilio-sendgrid',
  providerMessageRef: null,
  state: 'SUBMITTED',
  attemptCount: 1,
  nextRetryAt: null,
  lastError: null,
  createdAt: '2026-08-21T07:00:00.000Z',
  updatedAt: '2026-08-21T07:00:00.000Z',
};

describe('PostgresEmailRuntimeStore transactional outbox', () => {
  it('commits dispatch and outbox evidence in the same transaction', async () => {
    const statements: string[] = [];
    const events: DomainEventEnvelope[] = [];
    const client = {
      query(text: string) {
        statements.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
        return Promise.resolve({ rows: [], rowCount: 1 });
      },
      release() {
        statements.push('release');
      },
    } as unknown as pg.PoolClient;
    const pool = {
      connect: () => Promise.resolve(client),
    } as unknown as pg.Pool;
    const outbox: TransactionalOutboxWriter = {
      enqueue(receivedClient, event) {
        expect(receivedClient).toBe(client);
        events.push(event);
        return Promise.resolve();
      },
    };
    const store = new PostgresEmailRuntimeStore(pool, {
      outbox,
      mutationContext: {
        executionId: 'exec-1',
        correlationId: 'corr-1',
        actorPrincipalId: 'principal-1',
        evidence: ['core:execution:exec-1'],
      },
    });

    await store.saveDispatch(dispatch);

    expect(statements[0]).toBe('begin');
    expect(
      statements.some((statement) => statement.startsWith('insert into email_dispatches')),
    ).toBe(true);
    expect(statements.at(-2)).toBe('commit');
    expect(statements.at(-1)).toBe('release');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'email.dispatch.state_changed',
      aggregateType: 'EMAIL_TRANSPORT',
      aggregateId: 'dispatch-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      organizationId: 'org-1',
      correlationId: 'corr-1',
      causationId: 'exec-1',
    });
    expect(events[0]?.evidence).toContain('email:dispatch:submitted');
  });

  it('rolls back state if outbox enqueue fails', async () => {
    const statements: string[] = [];
    const client = {
      query(text: string) {
        statements.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
        return Promise.resolve({ rows: [], rowCount: 1 });
      },
      release() {
        statements.push('release');
      },
    } as unknown as pg.PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as pg.Pool;
    const outbox: TransactionalOutboxWriter = {
      enqueue() {
        return Promise.reject(new Error('TEST_OUTBOX_FAILURE'));
      },
    };
    const store = new PostgresEmailRuntimeStore(pool, {
      outbox,
      mutationContext: {
        executionId: 'exec-1',
        correlationId: 'corr-1',
        actorPrincipalId: 'principal-1',
        evidence: ['core:execution:exec-1'],
      },
    });

    await expect(store.saveDispatch(dispatch)).rejects.toThrow('TEST_OUTBOX_FAILURE');
    expect(statements).toContain('rollback');
    expect(statements).not.toContain('commit');
    expect(statements.at(-1)).toBe('release');
  });
});
