import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('M-FOUND-09 PostgreSQL EventRecord contract', () => {
  it('materializes canonical records, append-only revisions and globally unique external refs', () => {
    const migration = repositoryFile('migrations/011_event_record.sql');
    expect(migration).toContain('create table if not exists event_records');
    expect(migration).toContain('unique (tenant_id, event_key)');
    expect(migration).toContain('create table if not exists event_record_revisions');
    expect(migration).toContain('primary key (event_id, revision)');
    expect(migration).toContain('create table if not exists event_record_external_refs');
    expect(migration).toContain('unique (provider, reference_type, external_id)');
    expect(migration).toContain('EVENT_RECORD_HISTORY_MUTATION_FORBIDDEN');
    expect(migration).toContain('before update or delete on event_record_revisions');
    expect(migration).toContain('before update or delete on event_record_external_refs');
  });

  it('uses tenant-scoped idempotency and optimistic concurrency for the master record', () => {
    const store = repositoryFile('src/persistence/postgres-event-record-store.ts');
    expect(store).toContain('on conflict (tenant_id, event_key) do nothing');
    expect(store).toContain('EVENT_RECORD_IDEMPOTENCY_CONFLICT');
    expect(store).toContain('select * from event_records where event_id = $1 for update');
    expect(store).toContain('where event_id = $1 and version = $2');
    expect(store).toContain('EVENT_RECORD_VERSION_CONFLICT');
    expect(store).toContain('EVENT_RECORD_CONCURRENT_UPDATE');
  });

  it('persists the revision and corresponding domain event in the caller-owned transaction', () => {
    const store = repositoryFile('src/persistence/postgres-event-record-store.ts');
    expect(store).toContain('insert into event_record_revisions');
    expect(store).toContain('this.#outbox.enqueue(');
    expect(store).toContain('client,');
    expect(store).toContain("aggregateType: 'business_event'");
    expect(store).toContain('aggregateVersion: input.record.version');
    expect(store).toContain("await client.query('commit')");
    expect(store).toContain("await client.query('rollback')");
  });

  it('keeps external references generic and prevents cross-event provider identity reuse', () => {
    const store = repositoryFile('src/persistence/postgres-event-record-store.ts');
    expect(store).toContain('on conflict (provider, reference_type, external_id) do nothing');
    expect(store).toContain('EVENT_RECORD_EXTERNAL_REF_CONFLICT');
    expect(store).toContain("eventType: 'business_event.external_ref_attached'");
    expect(store).not.toContain('DoTicket');
    expect(store).not.toContain('Meta');
  });

  it('supports series lineage and interval-overlap schedule queries', () => {
    const store = repositoryFile('src/persistence/postgres-event-record-store.ts');
    expect(store).toContain('where tenant_id = $1 and series_key = $2');
    expect(store).toContain('and starts_at < $3::timestamptz');
    expect(store).toContain('and ends_at > $2::timestamptz');
    expect(store).toContain('order by starts_at asc, event_id asc');
  });

  it('must compare attributes canonically and fail closed on invalid persisted attributes', () => {
    const store = repositoryFile('src/persistence/postgres-event-record-store.ts');
    expect(store).toContain('canonicalJson(left.attributes) === canonicalJson(right.attributes)');
    expect(store).toContain('EVENT_RECORD_ATTRIBUTES_INVALID');
    expect(store).not.toContain(
      'JSON.stringify(left.attributes) === JSON.stringify(right.attributes)',
    );
  });
});
