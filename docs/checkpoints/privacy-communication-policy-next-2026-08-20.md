# TOCA OS Next — Privacy / Consent / Suppression Transversal Foundation — 2026-08-20

Status: **IMPLEMENTED — CI EVIDENCE PENDING ON FINAL HEAD**

## Baseline

- repository: `luizanunciostoca/toca-mcp-server`
- base branch: `main`
- base SHA: `cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`
- V1 remains formally `PRODUCTION_VERIFIED`; this checkpoint does not change the V1 release identity.
- canonical Privacy route remains `R16`.

## Reuse / reconciliation

This work does **not** create another privacy subsystem. It extends the R16 implementation already merged through historical Privacy PR #115 / commit `8fa4f35211fd90dff9b8dd4c2a020898e563e7e9` and preserves:

- `migrations/014_privacy_governance.sql`;
- append-only `privacy_ledger_events`;
- canonical `PrivacyGovernanceService`;
- existing purpose/legal-basis/consent/revocation/preference/retention/DSR/export/delete contracts;
- Approval Engine, Policy/Core, Audit and PostgreSQL stores already present in the repository.

Historical branches were inspected only as implementation evidence. They were not rebased or copied wholesale because they are materially behind current `main`.

## Canonical Drive alignment

The current TOCA_OS completion manual requires R16 to remain the unique source for purpose, legal basis, consent, revocation, preference and suppression. The outbound boundary is:

`canonical contact -> purpose/channel consent -> suppression -> policy -> approval when applicable -> provider -> readback -> audit/outbox/CRM`

This delta stops before provider send. No WhatsApp or Email provider implementation is part of this PR.

## Stable transversal API surface

The canonical service now provides/reuses:

- `canContact(contact, channel, purpose)`;
- `recordConsent(...)` — existing R16 method, preserving notice version, collection method, capture time and evidence provenance;
- `recordOptOut(...)`;
- `suppress(...)`;
- `resolveCommunicationPolicy(...)`;
- `reconcileProviderConsent(...)`;
- `evaluatePiiAccess(...)`.

## Fail-closed invariants

Communication is not eligible when any applicable condition is unknown or prohibited, including:

- ambiguous or unknown canonical identity;
- unknown/inactive purpose;
- missing communication policy;
- prohibited purpose;
- channel outside the purpose policy;
- invalid or expired permission window;
- unknown/missing required consent;
- revoked/denied consent;
- explicit opt-out;
- explicit suppression;
- unknown or suppressing provider consent state;
- unknown legal basis / pending legal review / future or expired legal basis;
- unknown or denied required preference.

Provider `OPTED_IN` is observational evidence only and never creates canonical consent.

## Suppression and provider reconciliation

Provider observations are recorded as opaque references plus evidence/readback references. The following observations materialize canonical suppression without provider mutation:

- `OPTED_OUT`;
- `UNSUBSCRIBED`;
- `BOUNCED`;
- `COMPLAINT`.

No message is sent and no provider write is executed by reconciliation.

## PII classification / minimization / access control

The transversal contract classifies data as:

- `PUBLIC`;
- `INTERNAL`;
- `PERSONAL`;
- `SENSITIVE`.

PII exposure requires an explicit authorization decision and is intersected with the declared minimum-necessary field set. Unknown authorization fails closed. Ledger payloads continue to reject obvious raw PII and store only opaque identifiers, field names and evidence references.

## Persistence / migrations

No new PostgreSQL migration is required for this delta.

Reason: migration `014_privacy_governance.sql` already provides the append-only, tenant/workspace/organization-scoped ledger with generic `privacy.*` capability IDs and JSONB event payloads. New event/capability IDs are enforced by the typed application registries and reuse the existing store and idempotency constraints.

## Evidence-state boundary

At checkpoint creation:

- implementation state: `IMPLEMENTED`;
- CI state: pending final exact-head Quality run;
- provider state: not applicable / no provider execution in this PR;
- production state: not promoted.

No evidence state may be promoted until the corresponding exact-head evidence exists.

## Required final validation

- `pnpm format:check`;
- architecture checks;
- lint;
- typecheck;
- unit tests, including communication policy / opt-out / suppression / provider reconciliation / PII minimization / idempotent retry;
- build;
- PostgreSQL E2E only if the final diff changes persistence or migration behavior. This delta intentionally reuses the already-tested migration/store and adds no persistence schema change.

## Provider safety statement

No WhatsApp send, Email send, campaign mutation, payment or other real external side effect is authorized or required for this PR.
