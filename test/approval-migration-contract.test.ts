import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('M-FOUND-05 PostgreSQL approval atomicity contract', () => {
  it('persists every execution lifecycle state and immutable execution claims', () => {
    const migration = repositoryFile('migrations/006_approval_execution_atomicity.sql');

    for (const state of [
      'RESERVED',
      'EXECUTING',
      'PROVIDER_READBACK',
      'RELEASED',
      'FAILED_REVIEW_REQUIRED',
    ]) {
      expect(migration).toContain(`'${state}'`);
    }
    expect(migration).toContain('create table if not exists approval_execution_claims');
    expect(migration).toContain('execution_id text primary key');
    expect(migration).toContain('approval_records_provider_readback_check');
    expect(migration).toContain('jsonb_array_length(provider_readback_evidence) > 0');
  });

  it('locks the approval row and claims execution IDs in the same transaction', () => {
    const store = repositoryFile('src/persistence/postgres-approval-store.ts');

    expect(store).toContain('select * from approval_records where approval_id = $1 for update');
    expect(store).toContain('insert into approval_execution_claims');
    expect(store).toContain("transition.type === 'RESERVE'");
    expect(store).toContain("await client.query('commit')");
    expect(store).toContain("await client.query('rollback')");
  });
});
