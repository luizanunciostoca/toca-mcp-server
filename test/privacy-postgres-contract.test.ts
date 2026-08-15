import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('R16 PostgreSQL privacy governance contract', () => {
  it('uses the post-CRM migration slot and materializes an append-only tenant-scoped ledger', () => {
    const migration = repositoryFile('migrations/014_privacy_governance.sql');

    expect(migration).toContain('create table if not exists privacy_ledger_events');
    expect(migration).toContain('tenant_id text not null');
    expect(migration).toContain('subject_ref text not null');
    expect(migration).toContain('constraint privacy_ledger_tenant_event_unique unique (tenant_id, event_id)');
    expect(migration).toContain("raise exception 'PRIVACY_LEDGER_APPEND_ONLY'");
    expect(migration).toContain('before update on privacy_ledger_events');
    expect(migration).toContain('before delete on privacy_ledger_events');
  });

  it('indexes privacy history through tenant-scoped subject, request and purpose boundaries', () => {
    const migration = repositoryFile('migrations/014_privacy_governance.sql');

    expect(migration).toContain(
      'on privacy_ledger_events (tenant_id, subject_ref, occurred_at, event_id)',
    );
    expect(migration).toContain(
      'on privacy_ledger_events (tenant_id, request_id, occurred_at, event_id)',
    );
    expect(migration).toContain(
      'on privacy_ledger_events (tenant_id, subject_ref, purpose_id, channel, occurred_at, event_id)',
    );
  });

  it('keeps all PostgreSQL reads tenant scoped and persistence insert-only', () => {
    const store = repositoryFile('src/persistence/postgres-privacy-ledger-store.ts');

    expect(store).toContain('insert into privacy_ledger_events');
    expect(store).toContain('where tenant_id = $1 and subject_ref = $2');
    expect(store).toContain('where tenant_id = $1 and request_id = $2::uuid');
    expect(store).not.toContain('update privacy_ledger_events');
    expect(store).not.toContain('delete from privacy_ledger_events');
  });

  it('documents the no-raw-personal-data invariant at the persistence boundary', () => {
    const migration = repositoryFile('migrations/014_privacy_governance.sql');

    expect(migration).toContain('Raw personal data must not be stored in payload/evidence');
    expect(migration).toContain('use opaque refs and governed artifacts');
  });
});
