from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"PATCH_ANCHOR_COUNT_INVALID:{path}:{count}")
    file.write_text(text.replace(old, new, 1))


for path in [
    "src/workflow/workflow-contracts.ts",
    "src/persistence/postgres-workflow-store.ts",
]:
    file = Path(path)
    text = file.read_text()
    text = text.replace("readonly output: unknown | null;", "readonly output: unknown;")
    text = text.replace("readonly completion: unknown | null;", "readonly completion: unknown;")
    file.write_text(text)

file = Path("src/workflow/in-memory-workflow-store.ts")
text = file.read_text()
replace_filter_old = "        if (step.status !== 'READY' || step.attempts >= step.maxAttempts) continue;"
replace_filter_new = "        if (step.status !== 'READY') continue;\n        if (step.startedAt === null && step.attempts >= step.maxAttempts) continue;"
if text.count(replace_filter_old) != 1:
    raise SystemExit(f"CLAIM_FILTER_ANCHOR_INVALID:{text.count(replace_filter_old)}")
text = text.replace(replace_filter_old, replace_filter_new, 1)

methods = [
    "create",
    "completeStep",
    "failStep",
    "retryStep",
    "openHumanTask",
    "claimHumanTask",
    "completeHumanTask",
    "scheduleTimer",
    "registerCompensation",
    "activateCompensations",
]
for method in methods:
    start = text.find(f"  async {method}(")
    if start < 0:
        raise SystemExit(f"ASYNC_METHOD_NOT_FOUND:{method}")
    promise = text.find("): Promise<", start)
    if promise < 0:
        raise SystemExit(f"ASYNC_RETURN_NOT_FOUND:{method}")
    body = text.find("{", promise)
    if body < 0:
        raise SystemExit(f"ASYNC_BODY_NOT_FOUND:{method}")
    insertion = "\n    await Promise.resolve();"
    if text[body + 1 : body + 1 + len(insertion)] != insertion:
        text = text[: body + 1] + insertion + text[body + 1 :]
file.write_text(text)

file = Path("src/persistence/postgres-workflow-store.ts")
text = file.read_text()
start = text.find("  async claimReadySteps(input: {")
end = text.find("\n\n  async completeStep(input: {", start)
if start < 0 or end < 0:
    raise SystemExit("CLAIM_METHOD_BOUNDARY_INVALID")
replacement = r'''  async claimReadySteps(input: {
    readonly workerId: string;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly WorkflowStepClaim[]> {
    requireText(input.workerId, 'WORKFLOW_WORKER_ID_REQUIRED');
    assertTimestamp(input.now, 'WORKFLOW_NOW_INVALID');
    assertLimit(input.limit);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const candidates = await client.query<Pick<WorkflowStepRow, 'workflow_id' | 'step_id'>>(
        `select s.workflow_id, s.step_id
         from workflow_steps s
         join workflow_instances w on w.workflow_id = s.workflow_id
         where s.status = 'READY'
           and (s.started_at is not null or s.attempts < s.max_attempts)
           and w.status in ('RUNNING', 'WAITING')
         order by w.updated_at asc, s.workflow_id asc, s.step_id asc
         limit $1`,
        [input.limit],
      );
      const claims: WorkflowStepClaim[] = [];
      for (const candidate of candidates.rows) {
        const instanceLock = await client.query<WorkflowInstanceRow>(
          `select * from workflow_instances
           where workflow_id = $1 and status in ('RUNNING', 'WAITING')
           for update skip locked`,
          [candidate.workflow_id],
        );
        if (!instanceLock.rows[0]) continue;

        const stepLock = await client.query<WorkflowStepRow>(
          `select * from workflow_steps
           where workflow_id = $1 and step_id = $2 and status = 'READY'
             and (started_at is not null or attempts < max_attempts)
           for update skip locked`,
          [candidate.workflow_id, candidate.step_id],
        );
        const row = stepLock.rows[0];
        if (!row) continue;

        const executionId = this.#createId();
        await this.#claimExecution(client, {
          executionId,
          workflowId: row.workflow_id,
          stepId: row.step_id,
          compensationId: null,
          workerId: input.workerId,
          claimedAt: input.now,
        });
        await client.query(
          `update workflow_steps set
             status = 'RUNNING',
             attempts = attempts + case when started_at is null then 1 else 0 end,
             claimed_by = $3,
             claim_execution_id = $4, claimed_at = $5::timestamptz,
             started_at = coalesce(started_at, $5::timestamptz),
             completed_at = null, error_code = null, version = version + 1
           where workflow_id = $1 and step_id = $2 and version = $6`,
          [row.workflow_id, row.step_id, input.workerId, executionId, input.now, row.version],
        );
        await this.#setInstanceStatus(client, row.workflow_id, 'RUNNING', input.now, null);
        await this.#appendWorkflowEvent(
          client,
          row.workflow_id,
          row.step_id,
          'STEP_CLAIMED',
          {
            workerId: input.workerId,
            executionId,
            attempt: row.started_at === null ? row.attempts + 1 : row.attempts,
          },
          [],
          input.now,
        );
        claims.push({
          workflowId: row.workflow_id,
          stepId: row.step_id,
          workerId: input.workerId,
          executionId,
          claimedAt: input.now,
        });
      }
      await client.query('commit');
      return claims;
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) throw new Error('WORKFLOW_EXECUTION_ID_ALREADY_CLAIMED');
      throw error;
    } finally {
      client.release();
    }
  }'''
file.write_text(text[:start] + replacement + text[end:])

replace_once(
    "migrations/007_durable_workflow_persistence.sql",
    "  unique (workflow_id, order_index),\n  foreign key (workflow_id, step_id)",
    "  unique (workflow_id, order_index),\n  unique (workflow_id, compensation_id),\n  foreign key (workflow_id, step_id)",
)
replace_once(
    "migrations/008_workflow_execution_claims.sql",
    "  compensation_id text references workflow_compensations (compensation_id) on delete restrict,",
    "  compensation_id text,",
)
replace_once(
    "migrations/008_workflow_execution_claims.sql",
    "  foreign key (workflow_id, step_id)\n    references workflow_steps (workflow_id, step_id) on delete restrict\n);",
    "  foreign key (workflow_id, step_id)\n    references workflow_steps (workflow_id, step_id) on delete restrict,\n  foreign key (workflow_id, compensation_id)\n    references workflow_compensations (workflow_id, compensation_id) on delete restrict\n);",
)
replace_once(
    "test/durable-workflow-migration.test.ts",
    "    expect(store).toContain('for update of s skip locked');",
    "    expect(store).not.toContain('for update of s skip locked');",
)
