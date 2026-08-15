from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"PATCH_ANCHOR_COUNT_INVALID:{path}:{count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "src/events/postgres-transactional-outbox.ts",
    "  type OutboxDeliveryAttempt,\n",
    "",
)

path = "src/persistence/postgres-workflow-store.ts"
replace_once(
    path,
    "import type pg from 'pg';\nimport {",
    "import type pg from 'pg';\nimport { createDomainEvent } from '../events/domain-events.js';\nimport { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';\nimport type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';\nimport {",
)
replace_once(
    path,
    "export interface PostgresWorkflowStoreOptions {\n  readonly createId?: () => string;\n}",
    "export interface PostgresWorkflowStoreOptions {\n  readonly createId?: () => string;\n  readonly outbox?: TransactionalOutboxWriter;\n}",
)
replace_once(
    path,
    "export class PostgresWorkflowStore implements WorkflowStore {\n  readonly #createId: () => string;",
    "export class PostgresWorkflowStore implements WorkflowStore {\n  readonly #createId: () => string;\n  readonly #outbox: TransactionalOutboxWriter;",
)
replace_once(
    path,
    "  ) {\n    this.#createId = options.createId ?? randomUUID;\n  }",
    "  ) {\n    this.#createId = options.createId ?? randomUUID;\n    this.#outbox = options.outbox ?? new PostgresTransactionalOutbox(pool);\n  }",
)

file = Path(path)
text = file.read_text()
start = text.find("  async #appendEvent(client: pg.PoolClient, input: Omit<WorkflowEvent, 'eventId'>): Promise<void> {")
end = text.find("\n\n  async #claimExecution(", start)
if start < 0 or end < 0:
    raise SystemExit("APPEND_EVENT_BOUNDARY_INVALID")
replacement = r'''  async #appendEvent(client: pg.PoolClient, input: Omit<WorkflowEvent, 'eventId'>): Promise<void> {
    assertJsonSerializable(input.payload);
    const eventId = this.#createId();
    await client.query(
      `insert into workflow_events (
         event_id, workflow_id, step_id, event_type, correlation_id,
         payload, evidence, occurred_at
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz)`,
      [
        eventId,
        input.workflowId,
        input.stepId,
        input.eventType,
        input.correlationId,
        json(input.payload),
        json(input.evidence),
        input.occurredAt,
      ],
    );

    const context = await client.query<
      Pick<
        WorkflowInstanceRow,
        'tenant_id' | 'workspace_id' | 'organization_id' | 'version'
      >
    >(
      `select tenant_id, workspace_id, organization_id, version
       from workflow_instances where workflow_id = $1`,
      [input.workflowId],
    );
    const instance = context.rows[0];
    if (!instance) throw new Error('WORKFLOW_NOT_FOUND');
    const domainEvent = createDomainEvent({
      eventKey: eventId,
      eventType: `workflow.${input.eventType.toLowerCase()}`,
      aggregateType: 'workflow',
      aggregateId: input.workflowId,
      aggregateVersion: instance.version,
      tenantId: instance.tenant_id,
      workspaceId: instance.workspace_id,
      organizationId: instance.organization_id,
      correlationId: input.correlationId,
      causationId: null,
      occurredAt: input.occurredAt,
      payload: {
        workflowEventId: eventId,
        workflowEventType: input.eventType,
        stepId: input.stepId,
        payload: input.payload,
      },
      evidence: [...input.evidence, `workflow-event:${eventId}`],
    });
    await this.#outbox.enqueue(client, domainEvent);
  }'''
file.write_text(text[:start] + replacement + text[end:])
