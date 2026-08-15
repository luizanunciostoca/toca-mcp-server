import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('M-FOUND-06 durable workflow concurrency invariants', () => {
  it('locks the workflow instance before the ready step claim', () => {
    const store = repositoryFile('src/persistence/postgres-workflow-store.ts');
    const instanceLock = "where workflow_id = $1 and status in ('RUNNING', 'WAITING')";
    const stepLock = "where workflow_id = $1 and step_id = $2 and status = 'READY'";

    expect(store).toContain('const candidates = await client.query<Pick<WorkflowStepRow');
    expect(store).toContain(instanceLock);
    expect(store).toContain(stepLock);
    expect(store.indexOf(instanceLock)).toBeLessThan(store.indexOf(stepLock));
    expect(store).toContain('for update skip locked');
    expect(store).not.toContain('for update of s skip locked');
  });

  it('binds compensation execution claims to the same workflow', () => {
    const persistence = repositoryFile('migrations/007_durable_workflow_persistence.sql');
    const claims = repositoryFile('migrations/008_workflow_execution_claims.sql');

    expect(persistence).toContain('unique (workflow_id, compensation_id)');
    expect(claims).toContain('foreign key (workflow_id, compensation_id)');
    expect(claims).toContain(
      'references workflow_compensations (workflow_id, compensation_id) on delete restrict',
    );
    expect(claims).not.toContain(
      'compensation_id text references workflow_compensations (compensation_id)',
    );
  });

  it('does not increment an attempt when a waiting step is merely resumed', () => {
    const inMemory = repositoryFile('src/workflow/in-memory-workflow-store.ts');
    const postgres = repositoryFile('src/persistence/postgres-workflow-store.ts');

    expect(inMemory).toContain(
      'const nextAttempts = step.startedAt === null ? step.attempts + 1 : step.attempts;',
    );
    expect(postgres).toContain(
      'attempts = attempts + case when started_at is null then 1 else 0 end',
    );
    expect(postgres).toContain(
      'attempt: row.started_at === null ? row.attempts + 1 : row.attempts',
    );
  });
});
