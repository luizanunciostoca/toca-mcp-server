# R16 Privacy / LGPD / Consent / Preferences checkpoint

## Scope

This checkpoint implements the privacy-governance foundation requested for R16 without adding a new route and without implementing WhatsApp or email delivery.

Implemented capabilities:

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

## Concurrency boundary with CRM

The branch was cut from `main` while M-FOUND-10 CRM Core Records was still outside `main`. Privacy therefore does not define, copy or import `ContactRecord`. The integration boundary is an opaque `subjectRef` plus tenant/workspace/organization execution scope.

The CRM work already reserved migrations `012` and `013`. Privacy therefore uses `migrations/014_privacy_governance.sql` to avoid a future migration-order collision.

## Canonical-source review

The implementation was reviewed against the current TOCA_OS Manual Tecnico Mestre, `04_GUIA_PARA_IA`, the canonical resource registry and the compliance area under `11_JURIDICO_E_COMPLIANCE`.

At implementation time, the canonical `07_LGPD` and `06_POLITICAS` folders existed but contained no operative policy documents. That absence is treated as a governance fact, not as permission to infer a legal basis or consent.

The code therefore remains fail-closed when purpose, legal-basis review, consent or required preference evidence is unknown.

## Domain invariants

1. Privacy history is tenant scoped.
2. Subjects are represented by opaque references; raw personal data does not belong in privacy ledger payloads or audit evidence.
3. Purpose definitions require an explicit policy reference and evidence before they can be resolved as known.
4. Legal basis is recorded only from an explicit external/legal determination. The service never selects a legal basis on behalf of the business.
5. Consent is an evidence-bearing append-only event and revocation creates a new event instead of mutating history.
6. Preferences are append-only events. The latest event determines the current channel/purpose preference.
7. Suppression fails closed when a required state is unknown.
8. Retention evaluation records a decision. Destructive retention decisions do not directly mutate data; destructive execution is delegated to the governed deletion capability.
9. Subject requests are tenant scoped and preserve request evidence and identity-verification references.
10. Automated-decision explanations and profiling reviews stay `UNKNOWN_BLOCKED` when source evidence is absent.

## Sensitive operations

`privacy.data_export.prepare` and `privacy.data_delete.execute` reuse the existing atomic Approval Engine rather than introducing a privacy-specific approval mechanism.

The approval is descriptor bound to the exact tenant, subject, request, policy and capability. Execution follows the existing reservation lifecycle and requires provider/data-gateway read-back evidence before the approval can be consumed.

Deletion is classified as destructive. If a sensitive operation fails after execution begins, the approval transitions to review-required rather than being silently reusable.

## Persistence

`privacy_ledger_events` is append only. PostgreSQL triggers reject both `UPDATE` and `DELETE` against the ledger. Reads in `PostgresPrivacyLedgerStore` always include `tenant_id` together with the subject or request boundary.

Deletion of governed subject data does not mean deletion of the privacy/audit history itself. The data gateway returns both deleted and retained targets so mandatory retention can remain explicit and auditable.

## Lifecycle truth

These capabilities are catalogued as `IMPLEMENTED` internal-engine capabilities because executable domain handlers, persistence contracts and tests exist. They are not promoted to `CONNECTED` or `PRODUCTION_VALIDATED`: no external privacy provider or production subject-rights workflow was falsely claimed.

## Out of scope

- Contact/Lead/Opportunity CRM implementation
- WhatsApp sending
- email sending
- automatic selection of legal basis
- implicit or inferred consent
- unrestricted automatic deletion without policy and approval
- provider-specific production validation
