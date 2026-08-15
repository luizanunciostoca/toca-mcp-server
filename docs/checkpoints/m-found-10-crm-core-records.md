# M-FOUND-10 — CRM Core Records

Status: implementation checkpoint; not `PRODUCTION_VALIDATED`.

## Scope delivered

This milestone adds persistent CRM core records without adding a route, MCP server or duplicate capability surface:

- `ContactRecord` with stable identity and tenant/workspace/organization scope;
- normalized contact channels for deterministic deduplication;
- `LeadRecord` with source, status, qualification, score, owner and SLA;
- `OpportunityRecord` with pipeline, stage, optional value, next action, owner and won/lost semantics;
- Contact → Lead → Opportunity lineage;
- optional EventRecord lineage with runtime scope validation;
- append-only record revisions;
- optimistic concurrency through aggregate versions and row locks;
- durable idempotency keys with canonical request hashes and response snapshots;
- DomainEvents written through the existing transactional outbox;
- internal core mutations appended to the existing hash-chained Audit Ledger in the same database transaction;
- deterministic scoped queries;
- PostgreSQL migration and source/unit contract tests.

## Canonical constraints preserved

- The system remains at 32 macro routes (`R01`–`R32`); no `R33` is introduced.
- The existing `R10` capability list remains unchanged and is locked by a compatibility test.
- No CRM record is exposed as a new MCP tool merely because persistence now exists.
- No second MCP server is introduced.
- No WhatsApp execution, email marketing, external proposal generation, ticketing, Google Business, Google Ads or UI is implemented.
- Contact channels are identity/contact data only. This milestone does not create a consent or LGPD policy engine.
- An optional EventRecord reference never replaces EventRecord as the canonical event aggregate.

## Invariants

1. Every aggregate is scoped by tenant, workspace and organization.
2. Every mutation requires idempotency key, execution ID, correlation ID, actor principal and evidence.
3. Contact channel uniqueness is enforced on scope + channel type + provider + normalized value.
4. Contact channel normalization is deterministic and provider rules are explicit.
5. Every mutable aggregate carries a monotonically increasing version.
6. Updates lock the current row and reject stale expected versions.
7. CRM revisions are append-only at the database layer.
8. Idempotency replays return the committed response snapshot; conflicting payloads fail closed.
9. Lead score is optional and bounded to 0–100.
10. Converted leads require sales qualification; disqualified leads require a reason.
11. Opportunity value is optional; a known value requires three-letter currency and a non-negative integer minor-unit amount.
12. Opportunities require pipeline and stage keys without hardcoding business-specific pipeline stages.
13. Won/lost/canceled transitions record closure; lost transitions require a loss reason.
14. Lead/opportunity links cannot cross scope or contact lineage.
15. Optional EventRecord links are checked against tenant/workspace/organization scope.
16. List queries use explicit deterministic ordering and bounded limits.
17. Revision, outbox event, Audit Ledger entry and aggregate mutation share one PostgreSQL transaction.

## Canonical sources consulted

- `TOCA_OS — MANUAL_TECNICO_MESTRE_DO_SISTEMA_COMPLETO_v1.1` — official master manual.
- `TOCA_OS — MANUAL_TECNICO_E_OPERACIONAL_MESTRE_v2.1 — 2026-08-14` — current technical continuity audit.
- `TOCA_OS — 04_GUIA_PARA_IA` — source-of-truth and MCP boundary rules.
- `TOCA_OS — CATALOGO_MACHINE_ACTIONABLE_DE_ROTAS_E_CAPABILITIES_v1.0` — confirms R10 `COMERCIAL_PARCERIAS` compatibility surface.
- repository `docs/architecture/marketing-sales-foundation-v1.md` — foundation milestone sequence and non-goals.

## Production validation boundary

This checkpoint is implementation evidence only. It must not promote CRM capabilities to `CONNECTED`, `INTEGRATION_VALIDATED` or `PRODUCTION_VALIDATED` without the evidence required by the capability lifecycle and later M-FOUND-12 production validation.
