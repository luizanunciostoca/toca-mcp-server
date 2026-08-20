# TOCA OS Next — WhatsApp Cloud API checkpoint

Date: 2026-08-20

## Scope

This checkpoint records the implementation boundary for real WhatsApp Cloud API transport on top of the canonical TOCA CRM and Privacy architecture.

The runtime preserves:

`AG-01/workflow -> ContactRecord -> Privacy/Consent -> Policy -> Approval -> idempotency -> canonical MessageRecord -> Meta WhatsApp Cloud API -> callback/readback -> transactional Outbox/Audit -> learning`

No second MCP, CRM, scheduler, Approval Engine, Policy Engine, database, provider-direct bypass, idempotency subsystem, Outbox or Audit Ledger is introduced.

## Canonical dependencies

- CRM ConversationRecord / MessageRecord: PR #22 (`feat/next-crm-sales-engine-advanced-20260820`).
- Privacy / Consent / Suppression activation contract: PR #19.
- Existing Meta webhook HMAC verifier and `/webhooks/meta` HTTP boundary.
- Existing MetaApiClient + SecretResolver credential path.
- Existing Transactional Outbox and Internal Audit Ledger.

## WhatsApp-owned transport state

Migration `030_whatsapp_provider_runtime.sql` adds only provider-side state:

- `whatsapp_conversation_bindings`;
- `whatsapp_dispatches`;
- `whatsapp_provider_events`;
- `whatsapp_message_media`;
- `whatsapp_throttle_buckets`.

`crm_conversations` and `crm_messages` remain canonical and are not recreated.

## Inbound

The authenticated Meta webhook boundary normalizes WhatsApp messages and status callbacks after `X-Hub-Signature-256` validation. Inbound messages resolve/create canonical ContactRecord, reuse/create canonical ConversationRecord, append canonical MessageRecord, process explicit opt-in/opt-out preference commands, persist attachment metadata, and invoke CRM workflow/human handoff when required.

## Outbound

Outbound requires the existing Omnichannel Contact + Privacy + Policy + Approval eligibility proof and a `PRODUCTION_VALIDATED` provider binding. Non-template messages require a valid 24-hour customer-service window. Templates require provider `APPROVED` readback and exact variables. Known rate-limit responses may enter bounded retry; ambiguous provider outcomes go directly to dead-letter/human handoff to prevent blind duplicate sends.

## Test evidence

Permanent tests:

- `test/whatsapp-cloud-webhook.test.ts`;
- `test/whatsapp-cloud-adapter.test.ts`;
- `test/whatsapp-postgres-e2e.test.ts`.

The permanent M-FOUND-12 PostgreSQL workflow includes the WhatsApp E2E. Pre-convergence exact-head Quality and PostgreSQL E2E were green. The converged tree also passed the complete local in-runner gate (`format`, architecture, lint, typecheck, tests and build) before commit. Final exact-head Quality run `32343204440` and PostgreSQL E2E run `32343204438` both passed on the converged head.

All one-shot convergence/repair workflows were removed from the final diff. Only permanent repository workflows remain.

## Provider evidence / blocker

No real WhatsApp send has been executed merely for testing.

Canonical read-only preflight `docs/operations/omnichannel-provider-read-preflight-2026-08-16.md` recorded missing `whatsapp_business_management` and `whatsapp_business_messaging` scopes on the available production token. Therefore WABA / Phone Number ID enumeration and provider promotion remain blocked until the correct Meta scopes and asset access are supplied and verified.

Current converged implementation state: `CI_VERIFIED` and `IMPLEMENTED`. `PROVIDER_VERIFIED` and `PRODUCTION_VERIFIED` are not claimed.

## Convergence of WhatsApp candidates #31 and #36

Central coordination PR #17 identified #31 and #36 as competing implementations. This branch is the convergence target and preserves the stronger semantics from both without merging duplicate histories.

Preserved from #31: ambiguity-aware canonical Contact resolution, verified WhatsApp recipient-to-Contact validation, canonical HUMAN_HANDOFF SalesActivity, and durable SUBMITTED state before provider execution so ambiguous outcomes cannot cause blind resend.

Preserved from #36: provider media metadata readback, unmatched status workflow handoff, and transport mutations atomically coupled to the existing Transactional Outbox and hash-chained Internal Audit Ledger.

Candidate #31's extra runtime AuditSink is deliberately not duplicated: the canonical transactional audit path is stronger because business mutation, Outbox and audit evidence share the same PostgreSQL transaction boundary.
