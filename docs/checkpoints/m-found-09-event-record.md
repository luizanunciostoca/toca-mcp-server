# M-FOUND-09 — EventRecord

Status: **VALIDATED IN RUNNER — OFFICIAL PR QUALITY GATE PENDING**

Milestone: `TOCA_OS_MARKETING_SALES_FOUNDATION_v1`

Base main SHA: `1a3333c0e31eeddb46af421ef5ced2ffca572d5d`

Validated full repository run: `31865371900` — **SUCCESS** (`pnpm quality`)

## Objective

Create the canonical business Event Master Record for real event occurrences and their lineage without confusing it with the technical domain-event envelope introduced by M-FOUND-07.

An EventRecord represents a business occurrence such as a public experience, party, private event or special activation. Event taxonomy remains business data; the foundation does not hardcode Toca-specific event names or provider-specific semantics.

## Canonical EventRecord

Each record contains:

- stable internal `eventId`;
- tenant-scoped idempotent `eventKey`;
- tenant/workspace/organization scope;
- optional `seriesKey` for recurring-event lineage;
- human name and generic business `eventType`;
- lifecycle status;
- start/end timestamps;
- IANA timezone;
- optional venue name;
- bounded primitive attributes;
- optimistic version;
- created/updated timestamps.

The schedule requires `endsAt > startsAt` and a valid IANA timezone.

## Business lifecycle

Supported statuses are:

`DRAFT → PLANNED → CONFIRMED → ON_SALE/SOLD_OUT → IN_PROGRESS → COMPLETED → ARCHIVED`

Controlled cancellation is supported from active pre/completion states and terminates in `CANCELED → ARCHIVED`.

Invalid backward or post-archive transitions fail closed. Repeating the same state is idempotent and does not fabricate another revision.

## Series and occurrence lineage

`seriesKey` groups multiple real occurrences of the same recurring business concept while preserving a distinct `eventId`/`eventKey` for every occurrence.

`event_record_revisions` records append-only snapshots for:

- `CREATED`;
- `DETAILS_UPDATED`;
- `STATUS_CHANGED`.

The revision number follows the EventRecord optimistic version, giving deterministic occurrence history without overwriting evidence.

## External provider references

`event_record_external_refs` attaches generic provider identities to an EventRecord without coupling the core model to DoTicket, Meta, Google or any other named provider.

Each reference stores:

- ref ID;
- event ID;
- provider;
- reference type;
- external ID;
- optional canonical HTTP/HTTPS URL;
- evidence;
- creation time.

`(provider, reference_type, external_id)` is globally unique, preventing the same provider-side event/product identity from being silently attached to multiple internal EventRecords.

References and revisions are append-only at the database layer.

## Idempotency and concurrency

Creation is idempotent on `(tenant_id, event_key)`.

Reusing the same key with the same normalized intent returns the existing record. Reusing it for a different intent fails with `EVENT_RECORD_IDEMPOTENCY_CONFLICT`.

Attribute comparison is canonical and key-order independent.

Updates lock the EventRecord row and require an expected optimistic version. A stale caller fails with a version/concurrency error instead of overwriting newer state.

Persisted attributes are decoded fail-closed: nested or otherwise unsupported values produce `EVENT_RECORD_ATTRIBUTES_INVALID` rather than being silently discarded.

## Transactional revision + domain event

Every create/details/status mutation writes the EventRecord change, its append-only revision and the corresponding domain event through the M-FOUND-07 transactional outbox using the same PostgreSQL `PoolClient` transaction.

Therefore the master record/revision and its domain event commit or roll back together.

External-reference attachment also emits `business_event.external_ref_attached` through the same transaction.

No provider/network write occurs inside these transactions.

## Queries

The store supports deterministic reads for:

- direct EventRecord lookup;
- all occurrences in a series;
- interval-overlap schedule queries within a tenant;
- revision history;
- provider reference history.

## Persistence

`migrations/011_event_record.sql` creates:

1. `event_records`;
2. `event_record_revisions`;
3. `event_record_external_refs`;
4. schedule/series/status indexes;
5. append-only database triggers for revision/reference history.

The migration is versioned but this milestone does **not** claim it has already been applied to production.

## Architectural boundary

M-FOUND-09 does **not**:

- create R33;
- create a second MCP server;
- change the 731 compatibility capability IDs;
- hardcode Sunset/The Party or any provider into the schema contract;
- implement CRM lead/contact/deal records (M-FOUND-10);
- promote external-write capabilities;
- perform provider business writes in tests;
- replace technical domain events/outbox with EventRecord.

M-FOUND-07 remains the technical event-delivery layer. EventRecord is the canonical **business event master**.

## Acceptance criteria

M-FOUND-09 is complete when:

1. each business occurrence has stable tenant-scoped identity;
2. recurring occurrences can share a series lineage without sharing identity;
3. schedule/timezone and lifecycle transitions are validated;
4. creation is idempotent and semantic attribute comparison is key-order independent;
5. updates use row locking and optimistic versions;
6. revisions are append-only and version-aligned;
7. provider references are generic, append-only and globally unique by provider identity;
8. persisted attribute decoding fails closed;
9. each EventRecord mutation emits a domain event through the same PostgreSQL transaction;
10. series and time-range queries are deterministic;
11. no CRM/provider-write scope is introduced;
12. full repository Quality Gate passes;
13. merge uses a fixed green head SHA;
14. post-merge `main` Quality Gate passes.

## Current evidence

The clean implementation head passed full repository `pnpm quality` in GitHub Actions run `31865371900`. The validation workflow and patch script removed themselves before the validated commit was pushed.

A normal pull-request Quality Gate is still required on the final checkpoint head before merge.

## Exit

After a fixed-head green merge and post-merge `main` validation, proceed to `M-FOUND-10 — CRM Core Records`.
