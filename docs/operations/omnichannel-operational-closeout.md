# Omnichannel operational closeout — WhatsApp, Email and Nurture

Date: 2026-08-17

Status: **CONTRACT LAYER PRESERVED / REAL PROVIDERS DEFERRED TO NEXT VERSION**

## V1 release decision

Real WhatsApp and Email provider execution is explicitly outside TOCA OS V1. Their absence is **not a V1 release blocker** and must not be reported as an unresolved V1 gap.

The existing Omnichannel contract/privacy/nurture work remains part of the V1 foundation. It must not be represented as a real send capability.

Canonical V1 classification:

| Scope                                        | V1 evidence state                                    | Executable provider send?                       | V1 disposition              |
| -------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- | --------------------------- |
| Omnichannel contracts and schemas            | `CODE_COMPLETE` for contract/specification scope     | No                                              | V1 foundation               |
| Privacy/R16 suppression dependency           | implemented/merged dependency                        | Used as policy foundation only                  | V1 foundation               |
| CRM `ContactRecord` resolution contract      | implemented/merged dependency                        | Used as identity foundation only                | V1 foundation               |
| Nurture durable workflow/timer model         | `CODE_COMPLETE` for internal contract/workflow scope | No external delivery without a channel provider | V1 foundation               |
| Real WhatsApp provider binding/send/readback | `PLANNED`                                            | **No**                                          | **DEFERRED / NEXT_VERSION** |
| Real Email provider binding/send/readback    | `PLANNED`                                            | **No**                                          | **DEFERRED / NEXT_VERSION** |

## Canonical executability truth

All 18 Omnichannel capabilities remain deliberately non-executable as external provider operations on canonical V1:

- lifecycle remains `SPECIFIED` in the existing Omnichannel model;
- `runtimeExposed=false`;
- `productionExecutionAllowed=false`;
- no WhatsApp/Email provider implementation is registered on the runtime surface;
- no real send/readback evidence is claimed.

A contract, schema, privacy check or durable nurture plan is not a provider binding.

## Existing V1 boundaries retained

### Privacy / R16

R16 remains the canonical source for purpose, legal basis, consent, revocation, preferences and suppression. Outbound execution must fail closed unless the exact scoped suppression decision is `ALLOWED`.

No Omnichannel provider may create a parallel consent/suppression ledger.

### CRM Core / ContactRecord

`ContactRecord` remains canonical. External delivery eligibility requires an unambiguous resolved contact. `AMBIGUOUS` and `NOT_FOUND` remain blocked before provider execution.

### Approval and idempotency

Future external sends remain `WRITE_EXTERNAL`, approval-gated and idempotency-bound at the TOCA execution layer. Provider acknowledgement timeouts or ambiguous responses must never cause blind resend.

### Nurture workflow/timers

Nurture remains bound to the existing durable workflow engine, timers, approvals, Transactional Outbox and Audit Ledger. No parallel scheduler or queue is introduced by this domain.

## Last provider-readiness inspection retained as historical evidence

The 2026-08-16 repository/runtime inspection found:

- no `src/providers/whatsapp` provider;
- no `src/providers/email` provider;
- no WhatsApp/Email provider registration path;
- no Omnichannel provider workflow;
- no approved WABA/phone-number production binding;
- no approved Email sender/domain production binding;
- no controlled real send/readback evidence.

Those findings remain accurate release evidence for why provider execution is not claimed in V1. They are now classified as **next-version work**, not V1 blockers.

## Next-version activation contract

When provider work resumes, validate each channel progressively and stop at the first failed gate:

`READ/VERIFY -> PREPARE -> CONTROLLED SEND -> PROVIDER READBACK`

For WhatsApp, the next version must bind the exact WABA/phone identity, approved credential, webhook/signature verification, required templates and one explicitly approved test recipient.

For Email, the next version must bind a selected provider, exact sender/domain, credential, required DKIM/SPF/DMARC/provider authentication, webhook/signature verification and one explicitly approved test inbox.

For both channels:

- resolve exactly one canonical `ContactRecord`;
- prove the canonical privacy decision is `ALLOWED` for the exact purpose/channel;
- bind approval and deterministic idempotency before mutation;
- send to one controlled test destination only;
- never blind-retry ambiguous provider results;
- capture the exact provider message/resource identifier;
- persist provider readback, Audit Ledger and Transactional Outbox evidence before promotion.

No fake adapter, unused secret, catalog entry or mock send may satisfy provider verification.

## CI truth

Historical green runs remain evidence for the exact historical SHAs they validated. The current V1 governance closeout has:

`CI_VERIFIED = PENDING_FINAL_ACTIONS_ROUND`

That pending CI flag is independent of the Omnichannel deferral and does not turn real WhatsApp/Email provider work into a V1 blocker.
