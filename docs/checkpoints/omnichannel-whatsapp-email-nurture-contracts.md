# Omnichannel CRM — WhatsApp, Email and Nurture contracts

Status: **BLOCKED BY PRIVACY/CONSENT — CONTRACTS READY, RUNTIME DISABLED**

Reconciled `main` SHA: `88de675febdb1142f65c1354effef2ef2a9e0588`

## Scope

This checkpoint prepares the provider-neutral contracts and fail-closed safety boundary for the Omnichannel CRM front without recreating CRM Core Records, Privacy/Consent or a second scheduler.

The requested capability surface is:

### WhatsApp

- `whatsapp.contact.resolve`
- `whatsapp.opt_in.verify`
- `whatsapp.template.validate`
- `whatsapp.message.prepare`
- `whatsapp.message.send`
- `whatsapp.message.readback`
- `whatsapp.conversation.ingest`

### Email

- `email.contact.resolve`
- `email.suppression.verify`
- `email.campaign.prepare`
- `email.campaign.send`
- `email.delivery.readback`
- `email.open.ingest`
- `email.click.ingest`

### Nurture

- `nurture.sequence.create`
- `nurture.sequence.enroll`
- `nurture.sequence.pause`
- `nurture.sequence.outcome.record`

## Dependency audit

The branch was originally cut from `76aec57a707161f4ca8484059b8ec302b9be6910`, when neither dependent front was canonical on `main`.

During final reconciliation:

- `M-FOUND-10 CRM Core Records` merged through PR #102 as commit `a33bfb18614b01b1f263edd1d8dee497c3a47495`;
- `ContactRecord` is now canonical in `src/crm/crm-records.ts` and the omnichannel contact proof type is bound to that canonical `ContactRecord['contactId']`;
- `Privacy / Consent / Preferences` PR #103 remains open/draft and is not canonical on `main`;
- the branch was replayed onto `main` SHA `88de675febdb1142f65c1354effef2ef2a9e0588` after the concurrent Google Business merge.

The remaining mandatory blocker is therefore:

- `PRIVACY_CONSENT_SUPPRESSION_NOT_CANONICAL_ON_MAIN`

This PR must remain blocked until Privacy/Consent is merged and the branch is rebased/revalidated again.

## Architectural decisions

These 18 capabilities remain dependency-gated specifications and are deliberately **not** added to the executable capability catalog or MCP runtime while Privacy/Consent is absent.

The current canonical catalog on the reconciled `main` already contains 745 entries after another independent front. This checkpoint does not mutate that catalog; tests assert that none of the 18 blocked Omnichannel IDs enters the catalog or runtime.

Future primary route mapping after dependency integration is:

- WhatsApp and Email channel lifecycle: `R30`;
- Nurture / CRM lifecycle: `R10`.

No `R33` is created.

All specifications remain `SPECIFIED`, `runtimeExposed=false` and `productionExecutionAllowed=false` while the Privacy blocker exists.

## CRM reuse

The canonical CRM core is reused rather than copied. `src/omnichannel/contracts.ts` imports the canonical `ContactRecord` type and uses `ContactRecord['contactId']` in contact-resolution and provider-send contracts.

No second `ContactRecord`, deduplication store, lead model or opportunity model is introduced by this front.

## Outbound safety contract

Single-recipient outbound requires all of the following evidence in the same tenant/workspace/organization/correlation scope:

1. one unambiguous resolved canonical `ContactRecord` identity;
2. purpose-bound consent with status `GRANTED` for the exact channel;
3. suppression decision with `suppressed=false`;
4. policy decision with `allowed=true`;
5. an active approval when the operation requires approval.

Ambiguous or unresolved identity, `UNKNOWN`/denied/revoked/expired consent, channel mismatch, suppression, policy denial or cross-scope evidence fails closed.

Batch email preparation/send uses an immutable audience-eligibility snapshot. Dispatch is invalid when any ambiguous, unresolved, unknown-consent, denied-consent, suppressed or policy-denied recipient remains in the snapshot.

## Provider boundary

No WhatsApp or email provider is selected by this checkpoint. No scopes, credentials, production configuration or provider support are invented.

Provider adapters expose contracts for template validation, send and read-back. A binding cannot be treated as production-ready until its state is explicitly `PRODUCTION_VALIDATED` with separate provider-backed evidence.

External send capabilities are `WRITE_EXTERNAL`, approval-required and non-idempotent at the provider boundary. Automatic blind resend is forbidden; provider read-back and reconciliation are required after uncertain results.

## Nurture boundary

Nurture sequences are modeled as definitions/instances of the existing durable workflow engine.

They must reuse the foundation's persisted workflow instances, steps, timers, human tasks, concurrency control, approvals, transactional outbox and audit ledger. This checkpoint introduces no scheduler, timer daemon or queue parallel to that foundation.

Enrollment requires the same ContactRecord, consent, suppression, policy and approval evidence as governed outbound. Pausing uses workflow-instance identity and optimistic versioning. Outcomes are append-only evidence attached to the workflow/audit lineage.

## What is intentionally not implemented

This checkpoint does not:

- define or duplicate `ContactRecord`;
- define or duplicate consent/preference/retention persistence;
- add a WhatsApp or email provider SDK;
- configure provider credentials or permission scopes;
- register MCP tools for these capabilities;
- promote any capability to `IMPLEMENTED`, `CONNECTED` or `PRODUCTION_VALIDATED`;
- send any WhatsApp message or email;
- create a parallel scheduler;
- merge while Privacy/Consent is absent.

## Quality history

Early branch runs exposed only local checkpoint issues and were corrected:

- initial Prettier normalization;
- strict optional-property fixture correction;
- readonly fixture correction;
- inventory test corrected to rely on canonical catalog behavior instead of a stale route-only count assumption.

A full Quality Gate must pass again after every reconciliation with `main` and, critically, after Privacy/Consent is merged.

## Integration gate after Privacy merge

Before this front can leave blocked status:

1. rebase/replay onto the then-current fixed `main` after Privacy/Consent merges;
2. bind the Privacy dependency ports to the canonical consent/suppression/purpose contracts instead of redefining them;
3. reconcile route consumption and register the 18 IDs as technical extensions only when their canonical contracts are available;
4. wire nurture to the existing durable workflow persistence, timers and human-task APIs;
5. wire outbound execution through existing policy, approval atomicity, idempotency, transactional outbox and audit ledger;
6. add a real provider adapter/configuration only with official provider permission evidence;
7. keep external sends below `PRODUCTION_VALIDATED` until integration and provider-backed smoke tests pass;
8. require provider read-back before reporting delivery/send completion;
9. run the complete repository Quality Gate on the rebased fixed head;
10. merge only by the exact green head SHA and run post-merge validation.

## Acceptance criteria for this blocked checkpoint

This pre-integration checkpoint is valid when:

- all 18 requested IDs have explicit closed contracts;
- canonical `ContactRecord` is reused rather than duplicated;
- Privacy decisions remain an external canonical dependency until PR #103 merges;
- unknown consent and ambiguous identity are impossible to pass as eligible outbound;
- provider adapters are unbound and production use is fail-closed;
- nurture refers to the durable workflow engine rather than a new scheduler;
- the existing capability catalog is not mutated by these blocked IDs;
- none of the 18 capabilities appears in the MCP runtime;
- tests lock these invariants;
- the repository Quality Gate passes on the reconciled branch;
- the PR remains draft/blocked until Privacy/Consent is canonical on `main`.
