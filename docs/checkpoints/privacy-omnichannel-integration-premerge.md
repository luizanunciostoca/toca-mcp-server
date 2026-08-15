# Privacy -> Omnichannel pre-merge integration audit

> Temporary integration checkpoint only. This branch is based on the real PR #115 head and MUST NOT be merged into `main`.

## Revalidated anchors

- `main`: `b0d067e9cc6b469fdb1421ab7a25a25a3b0f1f47`
- PR #115 / R16 Privacy head: `76a8ffea347939b5270f23b5a176f2a7dae3a2dd`
- PR #115 base: current `main` at the audit start
- PR #104 / Omnichannel head: `7a746bb901f03d9faf1b113de148f63fdefc62b6`
- PR #104 base: `88de675febdb1142f65c1354effef2ef2a9e0588`
- PR #104 is one `main` commit behind; the intervening commit is Measurement/Ticketing and does not change the Omnichannel/Privacy contracts.
- Exact-head PR #115 and PR #104 Quality Gate runs currently fail during Actions startup. No merge is permitted while the official fixed-head gate is unavailable.

## Dependency state

Already canonical on `main`:

- M-FOUND-10 CRM Core / `ContactRecord`
- M-FOUND-06 Durable Workflow Engine, timers and human tasks
- canonical Approval Engine with atomic reserve/execute/read-back/consume lifecycle
- M-FOUND-07 Transactional Outbox
- M-FOUND-08 Audit Ledger / audit sink contracts
- M-FOUND requester `ExecutionIdentity`

Not canonical on `main` yet:

- R16 Privacy / Consent / Preferences / Suppression from PR #115

Therefore PR #104 must remain `SPECIFIED`, runtime-disabled and production-disabled until #115 is merged and #104 is reconciled against the merged SHA.

## Canonical outbound chain after Privacy is merged

Omnichannel outbound must prove the following chain using canonical engines/stores rather than caller-asserted booleans:

1. requester `ExecutionIdentity` is authenticated and supplies tenant/workspace/organization
2. canonical CRM resolves exactly one active `ContactRecord` inside that scope
3. the contact resolves to one opaque Privacy `subjectRef` through a canonical binding; raw phone/email must not become the Privacy subject identifier
4. R16 resolves an active purpose
5. R16 evaluates approved legal basis
6. if that legal basis is `CONSENT`, R16 requires current granted consent for the exact purpose/channel
7. R16 evaluates retention/deletion suppression
8. when required by the outbound purpose/channel, R16 evaluates the current preference
9. R16 returns an `ALLOWED` suppression decision and appends the decision to the Privacy Ledger
10. policy/authorization is evaluated from the canonical requester identity
11. any required approval is loaded and atomically reserved from `ApprovalStore`; a caller-supplied `APPROVED` string is insufficient
12. provider binding must be `PRODUCTION_VALIDATED` before any real side effect
13. execution emits through the existing governed execution/outbox path
14. provider read-back evidence is mandatory
15. approval consumption occurs only after read-back
16. Audit Ledger records the execution/result with tenant/workspace/organization/correlation/requester evidence

No real provider execution is enabled by this audit.

## Contract incompatibilities found in PR #104

### 1. Consent is incorrectly mandatory for every outbound

`assertOutboundEligibility` and the capability schemas currently require `consent_status = GRANTED` for every WhatsApp send, email audience and nurture enrollment.

R16 explicitly supports an approved `OTHER_EXPLICIT_BASIS`. Its canonical `checkSuppression` only requires consent when the latest approved legal-basis event has `basisClass = CONSENT`.

Required reconciliation: Omnichannel must consume the R16 eligibility decision. It must not reinterpret `OTHER_EXPLICIT_BASIS` as missing consent and must never infer a legal basis itself.

### 2. Privacy proof objects in #104 are not canonical state

`ConsentDecisionProof`, `SuppressionDecisionProof` and the consent-centric audience counters are currently standalone Omnichannel structures. They are acceptable only as derived execution evidence, never as stores or caller-trusted state.

Required reconciliation: replace caller-asserted consent/suppression booleans with immutable references to the actual Privacy decision/event evidence generated for the exact subject, purpose, channel, execution and correlation.

### 3. Approval proof is too weak

`ApprovalDecisionProof { approvalId, status }` cannot prove requester, capability, descriptor, target account, scope, expiry, reservation execution or read-back lifecycle.

Required reconciliation: accept/resolve `approvalId`, then use the canonical `ApprovalStore` and descriptor-bound atomic transitions. Do not accept `approval_status=APPROVED` as authority.

### 4. `email.suppression.verify` lacks the Privacy decision key

The current input contains only `contact_record_id`. R16 `checkSuppression` requires `subjectRef`, `purposeId`, `channel` and whether preference is required.

Required reconciliation: `email.suppression.verify` must at least receive the applicable purpose and derive the opaque subject from the canonical CRM/Privacy binding. The email channel is fixed by the capability; preference applicability must come from canonical policy/configuration, not an arbitrary permissive default.

### 5. CRM -> opaque Privacy subject binding is not implemented by #115

PR #115 intentionally does not import or duplicate `ContactRecord`; its boundary is an opaque `subjectRef`. That is correct, but a canonical contact-to-subject binding/query is still required for Omnichannel.

The temporary compatibility bridge defines only a lookup seam with no persistence and no inference. It must be replaced/backed by the canonical binding selected after #115 is merged. Omnichannel must not create a second subject-identity store.

### 6. Workspace/organization must be non-null at the outbound boundary

CRM and requester identity have mandatory tenant/workspace/organization scope. R16 permits `workspaceId`/`organizationId` to be null because its ledger is tenant-scoped.

Required reconciliation: Omnichannel derives the three-part scope from `ExecutionIdentity`, validates the `ContactRecord` and subject binding against it, and passes the non-null workspace/organization into the Privacy execution context so Audit Ledger evidence remains fully scoped.

### 7. Canonical CRM cannot currently surface an ambiguous channel match

`CrmCoreStore.findContactByChannel` returns `ContactRecord | undefined`; the PostgreSQL implementation orders and `LIMIT 1`. PR #104 exposes `RESOLVED | AMBIGUOUS | NOT_FOUND`.

Required reconciliation: do not create a second contact index. Either extend the canonical CRM resolver/query so ambiguity can be represented, or prove through CRM uniqueness invariants that ambiguity is structurally impossible and collapse the public status contract accordingly. Until then, any detected integrity ambiguity must fail closed.

### 8. `nurture.sequence.pause` has no canonical Workflow Engine pause transition

The Durable Workflow Engine supports `RUNNING`, `WAITING`, `BLOCKED`, `SUCCEEDED`, `FAILED`, `CANCELED`; it has timers and human tasks but no arbitrary `PAUSED` state/transition.

Required reconciliation: add the minimum pause/resume semantic to the existing Workflow Engine if product semantics truly require it, or revise the Nurture contract to an existing canonical waiting state. Do not create a nurture scheduler/state store and do not fake pause with a far-future timer.

### 9. Audience eligibility is too consent-centric

Email campaign snapshots count `consentUnknownCount` and `consentDeniedCount`, but an audience member may be legally eligible under an explicitly approved non-consent basis.

Required reconciliation: aggregate the canonical R16 decision outcome/reasons (`privacyBlocked`, unknown legal basis, consent-required-and-missing, preference denied, retention/deletion suppression) without treating consent as universally required.

### 10. R16 suppression result lacks a direct decision event reference

R16 appends `SUPPRESSION_CHECKED` but returns only `SuppressionDecision`; it does not return the ledger event id/evidence.

The temporary bridge proves compatibility by reading the tenant+subject ledger back and requiring exactly one `SUPPRESSION_CHECKED` event for the same execution id, correlation id, purpose and channel. This is fail-closed but should not become the long-term runtime API.

Preferred post-merge hardening: expose an atomic Privacy decision proof containing the decision plus its ledger event id/evidence, or a canonical exact decision lookup. Do not reimplement the decision algorithm in Omnichannel.

## Capability reconciliation notes

### WhatsApp

- `whatsapp.contact.resolve`: use CRM canonical channel resolution; ambiguity gap above must be resolved fail-closed.
- `whatsapp.opt_in.verify`: should answer consent state for purposes whose legal basis requires consent; it must not become the general outbound authorization decision.
- `whatsapp.template.validate`: provider-neutral validation is compatible; no send authority is implied.
- `whatsapp.message.prepare`: require canonical contact + Privacy eligibility evidence. Preparation itself must not grant send authority.
- `whatsapp.message.send`: re-evaluate/bind current Privacy eligibility, policy, real approval and provider binding immediately before side effect; then require read-back and audit.
- `whatsapp.message.readback`: keep provider read-back evidence mandatory.
- `whatsapp.conversation.ingest`: resolve/attach only to canonical CRM contact identity; deduplicate with existing outbox/consumer receipt/idempotency primitives.

### Email

- `email.contact.resolve`: same canonical CRM constraints as WhatsApp.
- `email.suppression.verify`: add purpose and canonical subject resolution; call R16 rather than implementing email suppression logic.
- `email.campaign.prepare`: audience snapshot must be derived from per-recipient canonical Privacy eligibility.
- `email.campaign.send`: use canonical approval and provider binding; do not trust aggregate caller booleans.
- `email.delivery.readback`: mandatory before approval consumption/final success where approval applies.
- `email.open.ingest` / `email.click.ingest`: use canonical ContactRecord scope and existing idempotent event/outbox consumption; no second event bus.

### Nurture

- `nurture.sequence.create`: definition should bind to the Durable Workflow Engine; no scheduler duplication.
- `nurture.sequence.enroll`: use Workflow Engine scoped idempotency and perform Privacy eligibility before enrollment and again before each outbound step as necessary.
- `nurture.sequence.pause`: blocked on the pause semantic mismatch described above.
- `nurture.sequence.outcome.record`: record through existing workflow/event/audit primitives; do not create a nurture event bus.

## Temporary compatibility changes prepared

On `integration/privacy-omnichannel-compat-115-104` only:

- `src/omnichannel/privacy-compatibility.ts`
  - derives tenant/workspace/org and requester principal from canonical `ExecutionIdentity`
  - reads the canonical `ContactRecord`; no contact creation or duplicate CRM
  - uses a no-storage opaque-subject lookup seam pending the canonical CRM/Privacy binding
  - calls the actual PR #115 `PrivacyGovernanceService.resolvePurpose` and `checkSuppression`
  - does not implement a second consent/legal-basis/preference/suppression engine
  - records evidence references to actual Privacy Ledger events
  - correctly supports approved `OTHER_EXPLICIT_BASIS` without requiring fabricated consent
  - fails closed on missing contact, cross-scope contact, missing/ambiguous subject, purpose block, legal/consent/preference/retention suppression and missing decision proof

- `test/omnichannel-privacy-compatibility.test.ts`
  - explicit non-consent legal basis allowed without inferred consent
  - consent unknown blocked
  - consent revoked blocked
  - preference denied blocked
  - retention suppression blocked
  - missing contact blocked
  - cross-tenant contact blocked
  - ambiguous subject binding blocked
  - exact purpose/channel evidence binding

- `test/omnichannel-canonical-runtime-compatibility.test.ts`
  - duplicate nurture enrollment reuses canonical Workflow Engine idempotency
  - conflicting duplicate enrollment fails closed
  - retry uses canonical workflow retry lifecycle
  - current lack of `PAUSED` state is locked as an explicit compatibility blocker
  - Approval Engine cannot consume an outbound approval before provider read-back

PR #104 already contains a focused provider guard test proving that a merely `CONNECTED` provider is rejected and only `PRODUCTION_VALIDATED` passes. That invariant should be retained unchanged during reconciliation.

## Scenarios status

- contact nonexistent: covered by temporary canonical CRM/Privacy bridge test
- contact ambiguous: #104 proof-level test fails closed; canonical CRM ambiguity representation remains a reconciliation blocker
- consent unknown: covered against real R16 service/store
- consent revoked: covered against real R16 service/store
- suppression active: covered through real R16 retention suppression; R16 also covers deletion/consent suppression paths
- preference incompatible: covered against real R16 service/store
- cross-tenant contact: covered
- enrollment duplicated: covered against real Workflow Engine
- retry: covered against real Workflow Engine
- nurture paused: incompatibility test records absence of canonical pause primitive; no parallel scheduler created
- read-back absent: covered against canonical Approval Engine lifecycle
- provider not `PRODUCTION_VALIDATED`: already covered by PR #104 provider-guard test and must remain in the reconciled suite

## What must happen only after PR #115 is merged

1. rebase/reconcile PR #104 onto the exact merged Privacy SHA and current `main`
2. replace standalone consent/suppression/approval truth inputs with references derived from canonical Privacy/Approval stores
3. select or add the canonical CRM <-> opaque Privacy subject binding without creating a parallel identity store
4. fix `email.suppression.verify` and the consent-centric audience contracts
5. resolve the canonical CRM ambiguity contract and Workflow Engine pause semantic
6. wire runtime execution to requester identity, policy, Approval Engine, Transactional Outbox, provider binding/read-back and Audit Ledger
7. keep every Omnichannel capability runtime-disabled and production-disabled until these dependencies are complete
8. run the complete fixed-head Quality Gate and merge only after the official checks are green

## Minimal #104 reconciliation sequence

1. wait for #115 to merge; capture the exact merge SHA
2. update #104 from current `main` without changing scope
3. import R16 contracts/services/stores rather than copying their state models
4. introduce the canonical subject-binding adapter and derived Privacy eligibility proof
5. update WhatsApp, Email and Nurture schemas/tests to `consent when required`, not `consent always`
6. bind approvals by descriptor/execution and enforce provider read-back
7. reuse Workflow Engine idempotency/retry/timers/human tasks and Transactional Outbox/Audit Ledger
8. keep provider adapters non-production and perform no real sends
9. run `pnpm quality` locally where a repository checkout is available
10. run the official fixed-head GitHub Quality Gate; only then consider the #104 merge
