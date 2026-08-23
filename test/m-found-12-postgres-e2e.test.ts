import { describe, expect, it } from 'vitest';
import { PostgresTransactionalOutbox } from '../src/events/postgres-transactional-outbox.js';
import { PostgresAuditSink } from '../src/persistence/postgres-audit-sink.js';
import { PostgresCrmCoreStore } from '../src/persistence/postgres-crm-core-store.js';
import { PostgresEventRecordStore } from '../src/persistence/postgres-event-record-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';
import { PostgresWorkflowStore } from '../src/persistence/postgres-workflow-store.js';
import { createToolRegistry } from '../src/registry.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

const TENANT = 'm12-tenant';
const WORKSPACE = 'm12-workspace';
const ORGANIZATION = 'm12-organization';
const BASE = '2026-08-15T22:40:00.000Z';

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('M_FOUND_12_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('M-FOUND-12 PostgreSQL durability E2E', () => {
  it('survives process restarts across workflow, outbox, EventRecord, CRM and Audit Ledger', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const workflowId = `m12-workflow-${suffix}`;
    const correlationId = `m12-correlation-${suffix}`;
    const eventId = `m12-event-${suffix}`;
    const contactId = `m12-contact-${suffix}`;
    const leadId = `m12-lead-${suffix}`;
    const auditExecutionId = `m12-audit-execution-${suffix}`;
    const auditCorrelationId = `m12-audit-correlation-${suffix}`;

    const pool1 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    const workflow1 = new PostgresWorkflowStore(pool1);
    const outbox1 = new PostgresTransactionalOutbox(pool1);

    const created = await workflow1.create(
      {
        workflowId,
        routeId: 'R01',
        definitionId: 'm-found-12-postgres-restart',
        definitionVersion: '1.0.0',
        idempotencyKey: `m12-workflow-idempotency-${suffix}`,
        correlationId,
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        organizationId: ORGANIZATION,
        requesterPrincipalId: 'm12:postgres:e2e',
        input: { proof: 'durable-restart' },
        steps: [
          {
            stepId: 'persisted-step',
            name: 'Persisted step',
            capabilityId: 'system.health',
            input: { proof: true },
            maxAttempts: 2,
          },
        ],
      },
      BASE,
    );

    expect(created.instance.status).toBe('RUNNING');
    expect(created.steps).toHaveLength(1);
    expect(created.steps[0]).toMatchObject({
      stepId: 'persisted-step',
      status: 'READY',
      attempts: 0,
    });

    const claims = await workflow1.claimReadySteps({
      workerId: 'm12-worker-a',
      now: '2026-08-15T22:40:01.000Z',
      limit: 10,
    });
    expect(claims).toHaveLength(1);
    const claim = claims[0]!;

    const firstOutboxClaims = await outbox1.claimAvailable({
      workerId: 'm12-outbox-a',
      now: '2026-08-15T22:40:02.000Z',
      limit: 20,
    });
    expect(firstOutboxClaims.length).toBeGreaterThan(0);
    const retryTarget = firstOutboxClaims[0]!;
    await outbox1.markFailed({
      eventId: retryTarget.record.eventId,
      executionId: retryTarget.delivery.executionId,
      errorCode: 'M12_TRANSIENT_DELIVERY_FAILURE',
      evidence: ['m12:outbox:first-attempt-failed'],
      now: '2026-08-15T22:40:03.000Z',
      nextAttemptAt: '2026-08-15T22:40:10.000Z',
    });
    for (const claimed of firstOutboxClaims.slice(1)) {
      await outbox1.markDelivered({
        eventId: claimed.record.eventId,
        executionId: claimed.delivery.executionId,
        evidence: ['m12:outbox:delivered'],
        now: '2026-08-15T22:40:04.000Z',
      });
    }

    await pool1.end();

    const pool2 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    const workflow2 = new PostgresWorkflowStore(pool2);
    const outbox2 = new PostgresTransactionalOutbox(pool2);
    const recovered = await workflow2.get(workflowId);
    expect(recovered?.steps[0]).toMatchObject({
      stepId: 'persisted-step',
      status: 'RUNNING',
      attempts: 1,
      claimExecutionId: claim.executionId,
    });

    await expect(
      workflow2.completeStep({
        workflowId,
        stepId: 'persisted-step',
        executionId: 'm12-stale-execution',
        output: { ignored: true },
        evidence: ['m12:stale-claim-rejected'],
        now: '2026-08-15T22:40:05.000Z',
      }),
    ).rejects.toThrow();

    const completed = await workflow2.completeStep({
      workflowId,
      stepId: 'persisted-step',
      executionId: claim.executionId,
      output: { persisted: true },
      evidence: ['m12:workflow:completed-after-restart'],
      now: '2026-08-15T22:40:06.000Z',
    });
    expect(completed.instance.status).toBe('SUCCEEDED');
    expect(completed.steps[0]).toMatchObject({ status: 'SUCCEEDED', attempts: 1 });

    const secondOutboxClaims = await outbox2.claimAvailable({
      workerId: 'm12-outbox-b',
      now: '2026-08-15T22:40:11.000Z',
      limit: 50,
    });
    const retryClaim = secondOutboxClaims.find(
      (entry) => entry.record.eventId === retryTarget.record.eventId,
    );
    expect(retryClaim?.delivery.attemptNumber).toBe(2);
    expect(retryClaim?.record.attempts).toBe(2);
    if (!retryClaim) throw new Error('M_FOUND_12_RETRY_CLAIM_MISSING');
    const deliveredRetry = await outbox2.markDelivered({
      eventId: retryClaim.record.eventId,
      executionId: retryClaim.delivery.executionId,
      evidence: ['m12:outbox:retry-delivered-after-restart'],
      now: '2026-08-15T22:40:12.000Z',
    });
    expect(deliveredRetry.status).toBe('DELIVERED');
    for (const claimed of secondOutboxClaims.filter(
      (entry) => entry.record.eventId !== retryClaim.record.eventId,
    )) {
      await outbox2.markDelivered({
        eventId: claimed.record.eventId,
        executionId: claimed.delivery.executionId,
        evidence: ['m12:outbox:delivered-after-restart'],
        now: '2026-08-15T22:40:12.000Z',
      });
    }

    const eventStore2 = new PostgresEventRecordStore(pool2);
    const event = await eventStore2.create({
      eventId,
      eventKey: `m12-event-key-${suffix}`,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      organizationId: ORGANIZATION,
      name: 'M-FOUND-12 PostgreSQL Event',
      eventType: 'VALIDATION',
      status: 'CONFIRMED',
      startsAt: '2026-08-16T16:30:00-03:00',
      endsAt: '2026-08-16T22:00:00-03:00',
      timezone: 'America/Bahia',
      venueName: 'TOCA M12 isolated validation',
      correlationId,
      evidence: ['m12:event-record:created'],
      now: '2026-08-15T22:40:13.000Z',
    });
    expect(event.eventId).toBe(eventId);

    const crm2 = new PostgresCrmCoreStore(pool2);
    const mutation = {
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      organizationId: ORGANIZATION,
      executionId: `m12-crm-execution-${suffix}`,
      correlationId,
      actorPrincipalId: 'm12:postgres:e2e',
      evidence: ['m12:crm:durable-linkage'],
      now: '2026-08-15T22:40:14.000Z',
    } as const;
    const contact = await crm2.createContact({
      ...mutation,
      idempotencyKey: `m12-contact-idempotency-${suffix}`,
      contactId,
      contactType: 'PERSON',
      displayName: 'M12 Opaque Test Contact',
      attributes: { validation: true },
    });
    expect(contact.contactId).toBe(contactId);

    const lead = await crm2.createLead({
      ...mutation,
      idempotencyKey: `m12-lead-idempotency-${suffix}`,
      executionId: `m12-crm-lead-execution-${suffix}`,
      leadId,
      contactId,
      eventId,
      sourceType: 'M_FOUND_12_E2E',
      sourceRef: `workflow:${workflowId}`,
      attributes: { validation: true },
    });
    expect(lead).toMatchObject({ leadId, contactId, eventId });

    const registry = createToolRegistry();
    const audit2 = new PostgresAuditSink(pool2, registry);
    await audit2.write({
      executionId: auditExecutionId,
      correlationId: auditCorrelationId,
      toolName: 'system.health',
      requester: 'm12:postgres:e2e',
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      organizationId: ORGANIZATION,
      status: 'STARTED',
      evidence: ['m12:audit:started-before-restart'],
      createdAt: '2026-08-15T22:40:15.000Z',
    });

    await pool2.end();

    const pool3 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    try {
      const eventStore3 = new PostgresEventRecordStore(pool3);
      const crm3 = new PostgresCrmCoreStore(pool3);
      const audit3 = new PostgresAuditSink(pool3, createToolRegistry());

      expect(await eventStore3.get(eventId)).toMatchObject({
        eventId,
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        organizationId: ORGANIZATION,
      });
      expect(
        await crm3.getContact({
          tenantId: TENANT,
          workspaceId: WORKSPACE,
          organizationId: ORGANIZATION,
          contactId,
        }),
      ).toMatchObject({ contactId, tenantId: TENANT });
      expect(
        await crm3.getLead({
          tenantId: TENANT,
          workspaceId: WORKSPACE,
          organizationId: ORGANIZATION,
          leadId,
        }),
      ).toMatchObject({ leadId, contactId, eventId });
      expect(
        await crm3.getLead({
          tenantId: 'other-tenant',
          workspaceId: WORKSPACE,
          organizationId: ORGANIZATION,
          leadId,
        }),
      ).toBeUndefined();

      await audit3.write({
        executionId: auditExecutionId,
        correlationId: auditCorrelationId,
        toolName: 'system.health',
        requester: 'm12:postgres:e2e',
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        organizationId: ORGANIZATION,
        status: 'SUCCEEDED',
        evidence: ['m12:audit:succeeded-after-restart'],
        createdAt: '2026-08-15T22:40:16.000Z',
      });
      const verification = await audit3.verifyExecution(auditExecutionId);
      expect(verification).toMatchObject({ valid: true, recordCount: 2, lastSequence: 2 });

      const workflowRows = await pool3.query<{ count: string }>(
        'select count(*)::text as count from workflow_instances where workflow_id = $1',
        [workflowId],
      );
      const leadRows = await pool3.query<{ count: string }>(
        'select count(*)::text as count from crm_leads where lead_id = $1',
        [leadId],
      );
      expect(workflowRows.rows[0]?.count).toBe('1');
      expect(leadRows.rows[0]?.count).toBe('1');
    } finally {
      await pool3.end();
    }
  });
});

// Evidence-base-only trigger marker; never merge.
