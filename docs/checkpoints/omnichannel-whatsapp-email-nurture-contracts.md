# Omnichannel CRM — WhatsApp, Email and Nurture contracts

Status: **PRIVACY INTEGRATED — CONTRACTS READY / RUNTIME AND PROVIDERS DISABLED**

Reconciled base: `main@8fa4f35211fd90dff9b8dd4c2a020898e563e7e9`.

## Scope

This checkpoint defines provider-neutral, fail-closed contracts for the requested Omnichannel CRM surface without duplicating CRM Core, Privacy, workflow scheduling, transactional outbox or audit infrastructure.

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

## Canonical dependencies

CRM Core and Privacy are now canonical on `main`.

- `ContactRecord` remains owned by `src/crm/crm-records.ts`.
- R16 Privacy merged through PR #115 at `main@8fa4f35211fd90dff9b8dd4c2a020898e563e7e9`.
- Production migration gate applied `014_privacy_governance.sql` and verified `PRODUCTION_SCHEMA_MIGRATIONS_CURRENT=14`.
- `src/omnichannel/contracts.ts` imports canonical `PrivacyScope` and `SuppressionDecision` from `src/privacy/contracts.ts`.
- The former blocker `PRIVACY_CONSENT_SUPPRESSION_NOT_CANONICAL_ON_MAIN` is removed.

## Privacy integration contract

Omnichannel does not maintain a parallel consent or suppression model.

The canonical outbound privacy gate is `privacy.suppression.check`. Its `SuppressionDecision` incorporates the scoped purpose/legal-basis state and, when applicable, consent, revocation, channel preference, retention/delete suppression and unknown-state blocking.

Single-recipient outbound therefore requires, in one tenant/workspace/organization/correlation scope:

1. one unambiguous canonical `ContactRecord` resolution;
2. an opaque Privacy `subjectRef` binding;
3. a canonical Privacy execution reference;
4. `SuppressionDecision.state === ALLOWED` and `blocked === false` for the exact purpose/channel;
5. the independent outbound policy decision to allow the operation;
6. an active approval when required.

`SUPPRESSED`, `UNKNOWN_BLOCKED`, channel mismatch, identity ambiguity, cross-scope evidence or policy denial fails closed before any provider call.

The external capability schemas mirror this same boundary with `privacy_execution_id`, `privacy_subject_ref`, `privacy_state`, `privacy_blocked`, `privacy_purpose_id` and `privacy_channel`; they no longer define local `consent_status` or `suppression_decision_id` contracts.

Batch email eligibility records aggregate canonical Privacy results using separate zero-required counts for `UNKNOWN_BLOCKED` and `SUPPRESSED` recipients.

## Runtime and provider boundary

This PR does **not** activate Omnichannel.

All 18 capability specifications remain:

- `SPECIFIED`;
- `runtimeExposed=false`;
- `productionExecutionAllowed=false`.

They are deliberately not inserted into the executable capability catalog or MCP runtime by this checkpoint.

No WhatsApp or Email provider is selected here. No provider credentials/scopes are invented. A provider binding must be separately proven `PRODUCTION_VALIDATED` before external send can be enabled.

External sends remain `WRITE_EXTERNAL`, approval-required and non-idempotent at the provider boundary. Blind automatic resend is forbidden; uncertain results require provider read-back/reconciliation.

## Nurture boundary

Nurture reuses the existing TOCA durable workflow engine, including persisted workflow state, timers, human tasks, approvals, concurrency controls, transactional outbox and audit ledger. This checkpoint creates no parallel scheduler, timer daemon or queue.

## Route ownership

- WhatsApp and Email lifecycle: `R30`.
- Nurture / CRM lifecycle: `R10`.
- No `R33` is created.

## Validation evidence

The old six-file Omnichannel delta was replayed onto the post-Privacy main without conflicts.

- replay/materialization run `31917722667`: **SUCCESS**, including full `pnpm quality`;
- canonical Privacy binding run `31917888004`: **SUCCESS**, including Prettier plus full `pnpm quality`;
- the final PR head must still run the repository canonical Quality Gate after temporary reconciliation workflow removal.

## What remains intentionally out of scope

This contract checkpoint does not:

- duplicate `ContactRecord`;
- duplicate Privacy ledger, consent, preference or suppression persistence;
- implement a WhatsApp/Email provider SDK;
- configure outbound production credentials/scopes;
- expose the 18 capabilities as MCP tools;
- send a WhatsApp message or email;
- create another scheduler;
- promote any Omnichannel capability to `IMPLEMENTED`, `CONNECTED` or `PRODUCTION_VALIDATED`.

Those promotions require separate implementation/provider evidence and must preserve the existing Foundation controls: identity, typed schema, authorization, policy, risk, approval, idempotency, durable workflow, provider read-back, EventRecord/CRM where applicable, Transactional Outbox and Audit Ledger.

## Merge gate

The contract integration may merge only when:

1. the reconciled PR diff contains exactly the six Omnichannel files and no temporary workflow;
2. canonical Privacy imports/bindings remain in place;
3. all 18 capabilities remain non-runtime and production-disabled;
4. the exact-head canonical Quality Gate is green;
5. merge uses the exact validated head SHA;
6. post-merge `main` Quality is green.
