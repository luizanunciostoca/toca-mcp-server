# Measurement / Ticketing Read-Only / Attribution Foundation

## Scope

This checkpoint implements the technical foundation for the chain:

`content/ad -> visit -> checkout -> ticket -> event-attributable revenue`

It stays inside the existing R18 and R31 macroprocesses. No R33 or other route was introduced.

## Canonical sources consulted

- `TOCA_OS — MANUAL_TECNICO_MESTRE_DO_SISTEMA_COMPLETO_v1.1` — official/current master manual.
- `TOCA_OS — REGISTRO_MACHINE_ACTIONABLE_DE_ROTEAMENTO_v1.0` — R18/R31 routing, quality gates and hard-fail rules.
- `TOCA_OS — REGISTRO_CANONICO_DE_RECURSOS_E_IDS_v1.0` — canonical identity/governance source.
- GitHub `main` at the implementation baseline, including M-FOUND-09 EventRecord, transactional outbox, requester identity, durable workflows and Audit Ledger/observability.

## Implemented domain contracts

The internal foundation defines capability contracts for the following families without expanding the stable 731 compatibility catalog:

- `measurement.*`
- `tracking.*`
- `ticketing.*`
- `performance.funnel.*`
- `performance.attribution.*`
- `performance.event.*`

The contracts are intentionally separate from MCP tool advertisement. `IMPLEMENTED` means the local contract/domain logic exists. It does **not** mean a provider is connected or production-validated.

## Measurement

Implemented:

- measurement plan contract;
- UTM normalization for `source`, `medium`, `campaign`, `content`, `term`;
- canonical normalized measurement-event schema;
- append-only ingestion persistence;
- source-event idempotency;
- data-quality validation and score;
- monetary values stored in minor currency units;
- optional workflow instance lineage;
- requester principal/correlation/evidence lineage.

Ticketing-origin measurement fails closed without an EventRecord link.

## Ticketing read-only boundary

`TicketingReadOnlyAdapter` exposes only:

- resolve external event identity;
- read sales summary;
- read inventory.

The adapter exposes no payment, refund, transfer, administrative ticket issuance, inventory mutation, event mutation or financial write method.

Provider webhook ingestion is a local append-only ingestion operation. It does not perform a provider write. Raw payloads are represented by a deterministic SHA-256 plus a normalized primitive payload; the foundation does not require persistence of arbitrary raw personal data.

## EventRecord identity

Ticketing event bindings, sales snapshots, inventory snapshots, webhook receipts and conversion reconciliations require an existing EventRecord and enforce tenant/workspace/organization scope consistency.

The ticketing external event identity is unique by `(provider, external_event_id)` and can bind to only one EventRecord.

## Attribution and performance

Implemented deterministic analytics for:

- funnel;
- stage drop-off;
- first-touch attribution;
- last-touch attribution;
- linear attribution;
- explicit attribution confidence;
- conversion reconciliation confidence;
- event sales pacing using EventRecord timing and latest ticketing snapshots.

Confidence is based on source quality, identity continuity, reconciliation quality, campaign identity and available touchpoint sample. Consumers can require fail-closed behavior for unusable attribution.

## Persistence and reliability

Migration `013_measurement_ticketing_attribution.sql` creates append-only tables for:

- measurement plans;
- normalized measurement events;
- ticketing event bindings;
- ticketing sales snapshots;
- ticketing inventory snapshots;
- ticketing webhook receipts;
- conversion reconciliations.

The PostgreSQL store reuses the existing transactional outbox in the same SQL transaction as each persisted domain fact. It does not create another queue, outbox or audit ledger.

## Requester identity, workflow and audit reuse

`MeasurementFoundationService` requires an `ExecutionIdentity`, checks R18/R31 authorization and propagates tenant/workspace/organization scope, correlation ID, evidence and optional existing workflow instance ID.

The service accepts the existing `AuditSink`. `registerMeasurementAuditCapabilities()` registers the local capability metadata required by the existing Postgres Audit Ledger risk resolver without exposing those capabilities as MCP tools.

No workflow persistence or audit infrastructure is duplicated.

## Provider bindings

GA4, Search Console and Meta use a provider-neutral `MeasurementReadAdapter` contract. Ticketing uses a provider-neutral `TicketingReadOnlyAdapter` contract.

There is deliberately no concrete provider implementation in this checkpoint. Therefore these capabilities are not claimed as `CONNECTED`, `INTEGRATION_VALIDATED` or `PRODUCTION_VALIDATED`.

## Explicit exclusions

Not implemented in this checkpoint:

- payment creation or capture;
- refund;
- transfer/payout;
- provider-side ticket issuance;
- provider-side inventory mutation;
- provider-side event mutation;
- any financial write to the ticketing provider;
- invented GA4/Search Console/Meta/ticketing credentials or connectivity;
- a new route.

## Main reconciliation evidence

The implementation branch was created from `76aec57a707161f4ca8484059b8ec302b9be6910`. While this checkpoint was in progress, parallel milestones advanced `main`, including CRM Core Records and Google Business Local Discovery / Reputation.

Before final Quality validation, the branch was explicitly reconciled with `main` at `88de675febdb1142f65c1354effef2ef2a9e0588`. The conventional reconciliation merge commit `5a97f97114e360f9b6236628bc866e661609e2f4` uses the measurement head `21d5ae09dda34e536029d668f7edd6f88056b197` as first parent and that `main` commit as second parent.

Migration ordering was revalidated after the concurrent merges: `main` contains `012_crm_core_records.sql`, while the Google Business PR adds no migration, so `013_measurement_ticketing_attribution.sql` remains the next non-conflicting migration.

The final merge remains conditional on another fixed-head Quality Gate and a last `main` revalidation.

## Quality expectations

The branch must pass the repository Quality Gate at a fixed head before merge. Immediately before merge, `main` must be revalidated; if it moved, the branch must be reconciled and rerun. A post-merge Quality Gate on the resulting `main` commit is required.
