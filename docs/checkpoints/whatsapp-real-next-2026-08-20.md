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

Migration `027_whatsapp_provider_runtime.sql` adds only provider-side state:

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

The permanent M-FOUND-12 PostgreSQL workflow includes the WhatsApp E2E. Run `32336722157` passed on pre-format child head and proved real migrations, canonical CRM reuse, callback idempotency, throttle, restart, Outbox and Audit persistence. Final `CI_VERIFIED` requires fresh exact-head Quality + PostgreSQL E2E after every stack/base synchronization.

A one-shot repository Prettier helper was used during implementation and removed in the same bot commit. No temporary workflow remains in the final diff.

## Provider evidence / blocker

No real WhatsApp send has been executed merely for testing.

Canonical read-only preflight `docs/operations/omnichannel-provider-read-preflight-2026-08-16.md` recorded missing `whatsapp_business_management` and `whatsapp_business_messaging` scopes on the available production token. Therefore WABA / Phone Number ID enumeration and provider promotion remain blocked until the correct Meta scopes and asset access are supplied and verified.

Evidence state at this checkpoint: `IMPLEMENTED` only. `PROVIDER_VERIFIED` and `PRODUCTION_VERIFIED` are not claimed.
