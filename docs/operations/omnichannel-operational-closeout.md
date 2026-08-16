# Omnichannel operational closeout — WhatsApp, Email and Nurture

Status: **CONTRACT_READY / BLOCKED_EXTERNAL_PROVIDER**

Revalidated against `main@81f6f84df6b725bfc5994c2d1582241b7936c614` on 2026-08-16.

This closeout records the operational state of the existing Omnichannel domain. It does not create another consent model, another `ContactRecord`, another scheduler, another provider family, or additional public MCP tools.

## Final readiness classification

| Gate | WhatsApp | Email | Nurture |
| --- | --- | --- | --- |
| CONTRACT_READY | YES | YES | YES |
| PROVIDER_READY | NO | NO | INTERNAL ENGINE ONLY; outbound providers remain unavailable |
| REAL_SEND_VALIDATED | NO | NO | NO external send performed |
| READBACK_VALIDATED | NO | NO | NO external delivery read-back available |
| Operational classification | BLOCKED_EXTERNAL_PROVIDER | BLOCKED_EXTERNAL_PROVIDER | CONTRACT_READY, but external delivery remains blocked by channel providers |

No production send was attempted because there is no proven production provider binding and no explicitly approved safe test destination/sender binding. Creating a fake adapter or treating an unused secret as a provider binding would violate the production gate.

## Revalidated canonical dependencies

### Privacy / R16

R16 is the canonical source for purpose, legal basis, consent, revocation, preferences and suppression.

Omnichannel imports `PrivacyScope` and `SuppressionDecision` directly from `src/privacy/contracts.ts`. The outbound contracts use `privacy_execution_id`, `privacy_subject_ref`, `privacy_state`, `privacy_blocked`, `privacy_purpose_id` and `privacy_channel`; they do not define a parallel consent or suppression record.

The canonical gate is `privacy.suppression.check`.

Fail-closed behavior is enforced in R16 itself:

- unknown/inactive purpose -> `UNKNOWN_BLOCKED`;
- missing, pending, not-yet-valid or expired legal basis -> `UNKNOWN_BLOCKED`;
- consent-based purpose with no consent -> `UNKNOWN_BLOCKED` with `CONSENT_UNKNOWN`;
- revoked or denied consent -> `SUPPRESSED`;
- required preference with no value -> `UNKNOWN_BLOCKED`;
- preference DENY -> `SUPPRESSED`;
- retention/delete suppression -> `SUPPRESSED`;
- any state other than `ALLOWED` has `blocked=true`.

Omnichannel then refuses outbound execution unless the exact scoped decision is `ALLOWED` and not blocked. `UNKNOWN_BLOCKED` and `SUPPRESSED` fail before any provider call.

### CRM Core / ContactRecord

`ContactRecord` remains canonical in `src/crm/crm-records.ts`.

`ContactResolutionProof.contactRecordId` is typed from canonical `ContactRecord['contactId']`. CRM Core exposes `findContactByChannel(...)` for canonical channel-based contact lookup.

Outbound eligibility requires `ContactResolutionProof.status === RESOLVED` and a non-null canonical `contactRecordId`. `AMBIGUOUS` and `NOT_FOUND` are therefore blocked before Privacy/provider execution. The WhatsApp and Email contact-resolution capability schemas also return `RESOLVED | AMBIGUOUS | NOT_FOUND` and a nullable `contact_record_id` rather than creating another contact entity.

### Approval and idempotency

External sends remain `WRITE_EXTERNAL` and `approval_required=true`.

`whatsapp.message.send` and `email.campaign.send` require an active approved approval reference and an `idempotency_key`. The provider boundary is intentionally marked non-idempotent: the key protects TOCA execution semantics, but a timeout/ambiguous provider response must never trigger a blind resend. Reconciliation/read-back is required before any retry decision.

Nurture enrollment also carries approval/privacy eligibility plus an idempotency key and uses the durable workflow engine.

### Nurture workflow/timers

Nurture remains bound to the existing TOCA Core durable workflow engine. It does not create or require a parallel scheduler, timer daemon or queue.

Existing durable workflow state, timers, human tasks, approvals, concurrency controls, Transactional Outbox and Audit Ledger remain the execution substrate.

## Capability lifecycle

All 18 Omnichannel capabilities remain deliberately:

- `SPECIFIED`;
- `runtimeExposed=false`;
- `productionExecutionAllowed=false`;
- absent from the executable capability catalog;
- absent from the public MCP runtime surface.

The Privacy dependency blocker was legitimately removed after R16 merged. This does **not** imply provider readiness or production execution readiness.

No lifecycle promotion is justified by this closeout.

## Provider binding revalidation

Repository and runtime configuration visible through the GitHub integration contain no WhatsApp/Email provider implementation or binding:

- no `src/providers/whatsapp` provider;
- no `src/providers/email` provider;
- no WhatsApp/Email provider registration tool;
- no WhatsApp/Email provider workflow;
- no Omnichannel provider variables in `.env.example`;
- no approved WhatsApp number/WABA/phone-number binding in repository configuration;
- no approved Email sender/domain binding in repository configuration.

GitHub Actions secret and variable metadata are not readable by the current integration (`403 Resource not accessible by integration`). Secret values are intentionally not required or recorded here. Even if an unrelated secret exists, the repository currently has no Omnichannel runtime binding that could consume it, so that cannot be counted as `PROVIDER_READY`.

## BLOCKED_EXTERNAL_PROVIDER — WhatsApp

A real WhatsApp provider must be selected and bound before READ/VERIFY can begin. If Meta WhatsApp Cloud API is selected, the production gate requires at least the following real evidence:

1. **Credential**
   - production access token/system-user credential stored in the approved secret store;
   - token scopes/permissions sufficient for the bound WhatsApp Business Account and messaging operations;
   - no credential value committed to the repository.
2. **Account and sender binding**
   - exact Business Manager / WABA identifier;
   - exact `phone_number_id`;
   - exact sending E.164 number;
   - verified/approved display name and sender status at the provider.
3. **Webhook**
   - HTTPS callback bound to the production runtime;
   - webhook verification token stored as a secret;
   - provider app-secret signature validation before ingest;
   - subscription to the required message/status events;
   - replay/idempotency handling before `whatsapp.conversation.ingest` or status ingestion.
4. **Provider/business verification**
   - provider business verification and any account quality/eligibility gate required for production messaging.
5. **Template approval**
   - exact template name, language/locale, category and provider approval state for every template used outside an active customer-service window;
   - `whatsapp.template.validate` must read the provider state rather than trusting a local fixture.
6. **Safe validation destination**
   - one explicitly approved test recipient number;
   - canonical CRM `ContactRecord` resolution must be unambiguous;
   - canonical R16 decision must be `ALLOWED` for the exact purpose/channel;
   - active approval plus idempotency key.
7. **Read-back**
   - provider message identifier;
   - provider delivery/status read-back correlated to the exact send;
   - Audit Ledger and Transactional Outbox evidence.

WhatsApp does not require an email-style DNS sender setup; no DNS requirement should be invented for this provider.

## BLOCKED_EXTERNAL_PROVIDER — Email

A real email provider must be selected and bound before READ/VERIFY can begin. The production gate requires at least:

1. **Credential**
   - production API or SMTP credential in the approved secret store;
   - least-privilege provider permissions;
   - no credential value committed to the repository.
2. **Approved sender/domain**
   - exact From address and display identity;
   - exact sending domain;
   - provider verification state for both.
3. **DNS / authentication**
   - provider-required DKIM records verified;
   - SPF record/alignment verified for the selected sending path;
   - DMARC policy/alignment evidence suitable for production mail;
   - provider-required return-path/bounce or tracking-domain records, when applicable.
4. **Webhook**
   - HTTPS callback(s) for delivery, bounce, complaint and any enabled open/click events;
   - provider webhook signing secret/signature verification;
   - replay/idempotency protection before `email.delivery.readback`, `email.open.ingest` and `email.click.ingest`.
5. **Suppression interaction**
   - provider hard-bounce/complaint/unsubscribe state must never bypass canonical R16 suppression;
   - provider suppression signals must be ingested/reconciled into the canonical policy path rather than creating a competing consent ledger.
6. **Safe validation destination**
   - one explicitly approved test inbox;
   - unambiguous canonical `ContactRecord` resolution;
   - canonical R16 `ALLOWED` decision for the exact purpose/channel;
   - zero ambiguous/unresolved/unknown/suppressed/policy-denied recipients in the audience snapshot;
   - active approval plus idempotency key.
7. **Read-back**
   - exact provider message/campaign identifier;
   - delivery read-back for the safe test recipient;
   - Audit Ledger and Transactional Outbox evidence.

Because no email provider is selected, provider-specific credential names, DNS hostnames and webhook event names are intentionally not invented here. They must be recorded from the selected provider during binding.

## Required progressive validation after provider binding

The first real validation must use this order and must stop at the first failed gate:

`READ/VERIFY -> PREPARE -> CONTROLLED SEND -> PROVIDER READ-BACK`

### READ/VERIFY

- resolve exactly one canonical `ContactRecord`;
- block ambiguous or missing identity;
- execute canonical `privacy.suppression.check`;
- explicitly prove `UNKNOWN_BLOCKED` is blocked;
- explicitly prove `SUPPRESSED` is blocked;
- verify exact provider account/sender/template/domain state;
- verify the test destination is explicitly safe.

### PREPARE

- create only the deterministic prepared message/campaign descriptor;
- bind exact content/template/sender/destination/audience snapshot;
- bind approval and idempotency key;
- do not call the provider send operation.

### CONTROLLED SEND

- one recipient/test inbox/number only;
- never a real audience or campaign blast;
- no blind retry after timeout or ambiguous acknowledgement;
- capture the provider resource/message identifier immediately when returned.

### PROVIDER READ-BACK

- read the exact provider resource/message/delivery state;
- correlate it to the original execution/idempotency key;
- persist immutable audit evidence;
- only then may the specific controlled send path be considered validated.

## Blockers

### BLOCKER-OMNI-01 — provider implementations absent

WhatsApp and Email provider adapters are not present in the repository/runtime.

### BLOCKER-OMNI-02 — provider credentials cannot be proven

No Omnichannel credential binding is declared in repository configuration. GitHub secret/variable metadata is inaccessible to the current integration, and there is no runtime adapter that could consume an Omnichannel credential anyway.

### BLOCKER-OMNI-03 — sender identities not proven

No approved WhatsApp WABA/phone number or Email From/domain is bound in repository configuration.

### BLOCKER-OMNI-04 — webhooks not proven

No WhatsApp or Email provider webhook binding/signature verification path exists for the Omnichannel contracts.

### BLOCKER-OMNI-05 — WhatsApp template approval not proven

No provider-backed template read/approval evidence exists.

### BLOCKER-OMNI-06 — Email DNS/authentication not proven

No selected email provider/sending domain exists from which DKIM/SPF/DMARC/return-path verification can be proven.

### BLOCKER-OMNI-07 — safe test destinations not approved

No explicit safe WhatsApp test number or Email test inbox is recorded as an approved validation destination.

### BLOCKER-OMNI-08 — no real send/read-back evidence

No controlled external Omnichannel send has been executed, therefore no provider read-back can be claimed.

## Closeout decision

- **CONTRACT_READY:** YES for WhatsApp, Email and Nurture.
- **PROVIDER_READY:** NO for WhatsApp and Email. Nurture has its internal workflow substrate but cannot validate external delivery without those channel providers.
- **REAL_SEND_VALIDATED:** NO.
- **READBACK_VALIDATED:** NO.
- **BLOCKERS:** `BLOCKED_EXTERNAL_PROVIDER` as detailed above.

The next valid engineering step is provider selection/binding and a read-only preflight. It is not lifecycle promotion, MCP surface expansion, a fake adapter, or a production audience send.