import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/013_measurement_ticketing_attribution.sql', 'utf8');
const store = readFileSync('src/persistence/postgres-measurement-store.ts', 'utf8');
const adapters = readFileSync('src/measurement/adapters.ts', 'utf8');
const capabilityContracts = readFileSync('src/measurement/contracts.ts', 'utf8');

describe('measurement/ticketing postgres contract', () => {
  it('links every ticketing fact to EventRecord and preserves append-only history', () => {
    expect(migration).toContain('references event_records (event_id) on delete restrict');
    expect(migration).toContain("source_system <> 'TICKETING' or event_id is not null");
    expect(migration).toContain('ticketing_event_bindings_append_only');
    expect(migration).toContain('ticketing_sales_snapshots_append_only');
    expect(migration).toContain('ticketing_inventory_snapshots_append_only');
    expect(migration).toContain('ticketing_webhook_receipts_append_only');
    expect(migration).toContain('conversion_reconciliations_append_only');
    expect(migration).toContain('MEASUREMENT_HISTORY_MUTATION_FORBIDDEN');
  });

  it('enforces provider delivery and source-event idempotency', () => {
    expect(migration).toContain('unique (tenant_id, source_system, source_event_id)');
    expect(migration).toContain('unique (provider, external_event_id)');
    expect(migration).toContain('unique (provider, provider_delivery_id)');
    expect(store).toContain('MEASUREMENT_EVENT_IDEMPOTENCY_CONFLICT');
    expect(store).toContain('TICKETING_WEBHOOK_IDEMPOTENCY_CONFLICT');
  });

  it('reuses the transactional outbox instead of creating a parallel event bus', () => {
    expect(store).toContain('PostgresTransactionalOutbox');
    expect(store).toContain('createDomainEvent');
    expect(store).toContain('this.#outbox.enqueue');
    expect(migration).not.toContain('create table if not exists outbox');
  });

  it('keeps ticketing provider boundary read-only', () => {
    const match = adapters.match(/export interface TicketingReadOnlyAdapter\s*{([\s\S]*?)\n}/);
    const boundary = match?.[1] ?? '';

    expect(boundary).not.toBe('');
    expect(boundary).toContain('resolveEvent(');
    expect(boundary).toContain('readSalesSummary(');
    expect(boundary).toContain('readInventory(');
    expect(boundary).not.toMatch(
      /refund|transfer|issueTicket|createPayment|updatePayment|updateInventory/i,
    );
    expect(boundary.match(/^\s+[A-Za-z]\w*\([^\n]+/gm)).toHaveLength(3);
    expect(capabilityContracts).toContain('providerWritesAllowed: false');
  });

  it('does not add a route beyond R18/R31 for this foundation', () => {
    expect(capabilityContracts).toContain("routeId: 'R18' | 'R31'");
    expect(capabilityContracts).not.toContain("'R33'");
  });
});
