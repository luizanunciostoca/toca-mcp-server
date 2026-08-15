import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('M-FOUND-08 PostgreSQL audit ledger / observability contract', () => {
  it('creates append-only ledger, head and operational signal persistence', () => {
    const migration = repositoryFile('migrations/010_audit_ledger_observability.sql');
    expect(migration).toContain('create table if not exists audit_ledger_events');
    expect(migration).toContain('unique (execution_id, sequence)');
    expect(migration).toContain('create table if not exists audit_ledger_heads');
    expect(migration).toContain('create table if not exists operational_signals');
    expect(migration).toContain('APPEND_ONLY_LEDGER_MUTATION_FORBIDDEN');
    expect(migration).toContain('before update or delete on audit_ledger_events');
    expect(migration).toContain('before update or delete on operational_signals');
  });

  it('serializes writers per execution and advances the cryptographic head atomically', () => {
    const store = repositoryFile('src/persistence/postgres-audit-sink.ts');
    expect(store).toContain('pg_advisory_xact_lock(hashtext($1))');
    expect(store).toContain('select * from audit_ledger_heads where execution_id = $1 for update');
    expect(store).toContain('AUDIT_LEDGER_HEAD_CONCURRENT_UPDATE');
    expect(store).toContain('canonicalAuditPayload');
    expect(store).toContain('hashAuditPayload');
    expect(store).toContain('insert into audit_ledger_events');
    expect(store).toContain('update audit_ledger_heads set');
  });

  it('keeps compatibility audit projection and durable observability in the same transaction', () => {
    const store = repositoryFile('src/persistence/postgres-audit-sink.ts');
    expect(store).toContain('insert into audit_events');
    expect(store).toContain('await this.#signals.write(client');
    expect(store).toContain("await client.query('commit')");
    expect(store).toContain("await client.query('rollback')");
    expect(store).toContain('auditEventId: eventId');
    expect(store).toContain('name: `execution.${event.status.toLowerCase()}`');
  });

  it('verifies ledgers from a repeatable-read snapshot and exposes correlated signals', () => {
    const audit = repositoryFile('src/persistence/postgres-audit-sink.ts');
    const signals = repositoryFile('src/persistence/postgres-operational-observability.ts');
    expect(audit).toContain('begin isolation level repeatable read read only');
    expect(audit).toContain('verifyAuditLedger');
    expect(audit).toContain('listByCorrelation');
    expect(signals).toContain('listByExecution');
    expect(signals).toContain('listByCorrelation');
    expect(signals).toContain('order by occurred_at asc, signal_id asc');
  });
});
