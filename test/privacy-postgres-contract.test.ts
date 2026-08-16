import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('R16 PostgreSQL privacy governance contract', () => {
  it('uses migration 014 and materializes an append-only fully scoped ledger', () => {
    const migration = repositoryFile('migrations/014_privacy_governance.sql');

    expect(migration).toContain('create table if not exists privacy_ledger_events');
    expect(migration).toContain('tenant_id text not null');
    expect(migration).toContain('workspace_id text not null');
    expect(migration).toContain('organization_id text not null');
    expect(migration).toContain('subject_ref text not null');
    expect(migration).toContain('privacy_ledger_execution_idempotency_unique');
    expect(migration).toContain("raise exception 'PRIVACY_LEDGER_APPEND_ONLY'");
    expect(migration).toContain('before update on privacy_ledger_events');
    expect(migration).toContain('before delete on privacy_ledger_events');
  });

  it('uses a database sequence for deterministic causal ordering', () => {
    const migration = repositoryFile('migrations/014_privacy_governance.sql');
    const store = repositoryFile('src/persistence/postgres-privacy-ledger-store.ts');

    expect(migration).toContain('ledger_sequence bigserial not null unique');
    expect(store).toContain('order by ledger_sequence asc');
    expect(store).toContain('order by ledger_sequence desc');
  });

  it('enforces consent-version and revocation uniqueness in PostgreSQL', () => {
    const migration = repositoryFile('migrations/014_privacy_governance.sql');

    expect(migration).toContain('privacy_consent_version_unique');
    expect(migration).toContain("payload ->> 'consentVersion'");
    expect(migration).toContain('privacy_consent_revocation_unique');
    expect(migration).toContain("payload ->> 'consentEventId'");
  });

  it('serializes consent transitions under an advisory transaction lock', () => {
    const store = repositoryFile('src/persistence/postgres-privacy-ledger-store.ts');

    expect(store).toContain('pg_advisory_xact_lock');
    expect(store).toContain('PRIVACY_CONSENT_CONCURRENT_UPDATE');
    expect(store).toContain("event_type in ('CONSENT_RECORDED', 'CONSENT_REVOKED')");
  });

  it('keeps every PostgreSQL read tenant/workspace/organization scoped and insert-only', () => {
    const store = repositoryFile('src/persistence/postgres-privacy-ledger-store.ts');

    expect(store).toContain('insert into privacy_ledger_events');
    expect(store).toContain('where tenant_id = $1');
    expect(store).toContain('and workspace_id = $2');
    expect(store).toContain('and organization_id = $3');
    expect(store).not.toContain('update privacy_ledger_events');
    expect(store).not.toContain('delete from privacy_ledger_events');
  });

  it('documents and runtime-enforces the no-raw-personal-data boundary', () => {
    const migration = repositoryFile('migrations/014_privacy_governance.sql');
    const runtime = [
      repositoryFile('src/privacy/privacy-governance-base.ts'),
      repositoryFile('src/privacy/privacy-governance-helpers.ts'),
    ].join('\n');
    const store = repositoryFile('src/persistence/postgres-privacy-ledger-store.ts');

    expect(migration).toContain('Raw personal data must not be stored in payload/evidence');
    expect(migration).toContain('only opaque subject references are accepted');
    expect(runtime).toContain('PRIVACY_RAW_PII_EVIDENCE_REJECTED');
    expect(runtime).toContain('PRIVACY_RAW_PII_PAYLOAD_REJECTED');
    expect(runtime).toContain('PRIVACY_SUBJECT_REF_NOT_OPAQUE');
    expect(store).toContain('PRIVACY_RAW_PII_EVIDENCE_REJECTED');
    expect(store).toContain('PRIVACY_RAW_PII_PAYLOAD_REJECTED');
    expect(store).toContain('PRIVACY_SUBJECT_REF_NOT_OPAQUE');
  });
});
