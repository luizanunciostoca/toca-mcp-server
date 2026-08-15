import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('M-FOUND-06 durable workflow persistence schema', () => {
  it('materializes every durable workflow entity without preempting the M-FOUND-07 outbox', () => {
    const migration = repositoryFile('migrations/007_durable_workflow_persistence.sql');
    for (const table of [
      'workflow_instances',
      'workflow_steps',
      'workflow_dependencies',
      'workflow_events',
      'workflow_human_tasks',
      'workflow_timers',
      'workflow_compensations',
    ]) {
      expect(migration).toContain(`create table if not exists ${table}`);
    }
    expect(migration).not.toContain('event_outbox');
    expect(migration).toContain(
      "status in ('RUNNING', 'WAITING', 'BLOCKED', 'SUCCEEDED', 'FAILED', 'CANCELED')",
    );
    expect(migration).toContain('workflow_timers_due_idx');
    expect(migration).toContain('workflow_compensations_ready_idx');
  });

  it('keeps execution claims immutable and globally unique', () => {
    const claims = repositoryFile('migrations/008_workflow_execution_claims.sql');
    expect(claims).toContain('create table if not exists workflow_execution_claims');
    expect(claims).toContain('execution_id text primary key');
    expect(claims).toContain('check ((step_id is not null) <> (compensation_id is not null))');
  });

  it('uses row locking, SKIP LOCKED and repeatable-read snapshots in the PostgreSQL store', () => {
    const store = repositoryFile('src/persistence/postgres-workflow-store.ts');
    expect(store).not.toContain('for update of s skip locked');
    expect(store).toContain('for update skip locked');
    expect(store).toContain('select * from workflow_instances where workflow_id = $1 for update');
    expect(store).toContain('select * from workflow_steps');
    expect(store).toContain('begin isolation level repeatable read read only');
    expect(store).toContain('insert into workflow_execution_claims');
    expect(store).not.toContain('event_outbox');
  });
});
