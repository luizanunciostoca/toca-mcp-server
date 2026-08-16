# R16 — Privacy, LGPD, Consent, Preferences and Suppression

Status: **IMPLEMENTATION + HARDENING COMPLETE / EXACT-HEAD QUALITY BLOCKED BY ACTIONS**

Validated base before this checkpoint repair: `main@b0d067e9cc6b469fdb1421ab7a25a25a3b0f1f47`.

PR: #115 — `feat/r16-privacy-consent-preferences-v2`.

## Scope

R16 provides the privacy-governance domain needed by CRM and outbound channels without duplicating CRM records and without implementing WhatsApp or Email delivery.

Capabilities:

- `privacy.purpose.resolve`
- `privacy.legal_basis.record`
- `privacy.consent.record`
- `privacy.consent.revoke`
- `privacy.suppression.check`
- `privacy.preference.update`
- `privacy.retention.apply`
- `privacy.subject_request.create`
- `privacy.subject_request.status`
- `privacy.data_export.prepare`
- `privacy.data_delete.execute`
- `privacy.automated_decision.explain`
- `privacy.profiling.review`

Migration: `014_privacy_governance.sql`.

## Canonical domain boundary

CRM Core already owns `ContactRecord`. Privacy does not create, copy or mutate another contact master.

Privacy receives an opaque `subjectRef` plus complete scope:

- `tenantId`
- `workspaceId`
- `organizationId`

Resolution between a `subjectRef` and a canonical CRM contact belongs to CRM/integration code. Privacy stores only the governance facts required to decide whether a scoped use is allowed, suppressed, unknown or requires further review.

## Frozen invariants

1. Every operation is tenant/workspace/organization scoped.
2. `subjectRef` is opaque; obvious raw email, phone or CPF-like identifiers are rejected from subject references and sanitized evidence surfaces.
3. Purpose must be explicit and scope-resolved.
4. Legal basis is recorded only from explicit upstream determination/evidence; R16 never invents or infers a basis.
5. Future-dated legal-basis records remain inactive until their effective time.
6. Consent is append-only and monotonically versioned.
7. Revocation appends a new event bound to the exact consent history; it never edits historical consent.
8. Consent head transitions are serialized; stale/replayed versions fail closed.
9. A later consent after revocation requires a new explicit event and new evidence.
10. Preference is purpose/channel bound. Missing preference never becomes implicit permission.
11. Suppression is authoritative over consent/preferences when revocation, denial, retention/delete or unknown required state applies.
12. Unknown required consent/preference/governance state fails closed for outbound eligibility.
13. Retention records a governed decision; destructive data deletion remains a separate approved capability.
14. Retention against an opaque subject requires an explicit upstream subject-binding reference.
15. Subject requests preserve requester and identity-verification reference.
16. Export/delete do not proceed while the subject identity remains unverified.
17. Export/delete approvals bind capability, complete scope, subject, request, request type, identity-verification reference, policy and operation parameters.
18. Delete approval binds the canonical retention-policy-ref set so the destructive payload cannot drift after approval.
19. Sensitive operations consume approval only after provider/data-gateway read-back evidence is accepted.
20. Privacy ledger writes are append-only and idempotent on complete scope + execution + capability; mutated retries conflict instead of rewriting history.
21. Audit evidence must not contain raw subject data.
22. Automated-decision/profiling review remains `UNKNOWN_BLOCKED` when required evidence is absent.
23. R16 does not send messages, schedule campaigns or create another scheduler/outbox/workflow engine.

## Storage and concurrency

The PostgreSQL implementation persists an append-only privacy ledger under the complete scope. Consent version transitions are protected at the storage boundary so concurrent callers cannot both advance the same head from the same prior version.

The in-memory implementation mirrors the same domain invariants for deterministic tests; it is not a separate behavioral contract.

## Sensitive-operation evidence

The regression suite explicitly covers:

- idempotent replay versus mutated retry conflict;
- export/delete blocked before subject identity verification;
- complete-scope approval binding;
- cross-workspace access failure;
- post-approval retention-policy mutation failure;
- delete gateway not invoked without valid approval;
- explicit subject binding for retention;
- retention/delete suppression overriding otherwise-allowable marketing state;
- unknown automated-decision/profiling state failing closed;
- scoped audit events without raw subject data.

## Omnichannel integration contract

PR #104 / Omnichannel remains downstream of R16. Its final reconciliation must consume these canonical decisions rather than reproduce them.

Before any WhatsApp or Email outbound attempt, Omnichannel must prove:

1. one unambiguous canonical `ContactRecord` resolution;
2. exact privacy scope and opaque subject binding;
3. purpose resolution;
4. channel-specific consent/preference state when required by policy;
5. `privacy.suppression.check` returns an explicitly allowable state;
6. outbound provider configuration/account binding is valid;
7. applicable approval/idempotency/read-back requirements are satisfied.

Unknown contact, ambiguous identity, unknown consent/preference or suppression must block outbound before the provider call.

Omnichannel must not copy the privacy ledger, consent state, suppression state or ContactRecord master.

## Merge order

Required order:

1. revalidate #115 against then-current `main`;
2. exact-head canonical Quality Gate must start and pass;
3. merge #115 using the exact validated head SHA;
4. confirm post-merge `main` Quality;
5. reconcile #104 against the merged Privacy migration/contracts;
6. remove/avoid any duplicate privacy-domain abstraction in #104;
7. run exact-head Quality on the reconciled Omnichannel PR;
8. only then consider Omnichannel merge/provider-write validation.

## Current blocker

At the time of this checkpoint repair, GitHub Actions is failing before jobs are created. This is an external CI startup condition, not a passing Quality result.

Therefore R16 is **code/hardening complete but not merge-authorized**. Do not bypass the gate and do not merge Omnichannel first.
