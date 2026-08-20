# Real Email / Twilio SendGrid — implementation checkpoint

Date: 2026-08-20

## State

- Implementation: `IMPLEMENTED`
- Email-owned CI verification: `PASS`
- Stacked repository integration: `PASS`
- Global Quality Gate: `PASS`
- PostgreSQL E2E: `PASS`
- Provider validation: `PENDING_EXTERNAL_CONFIGURATION`
- Production promotion: `NOT_ALLOWED`
- Provider: Twilio SendGrid
- Email PR: #23
- CRM dependency: PR #22
- Privacy dependency: PR #19
- Clean implementation commit: `fe078cc70f720e15f34fba445a21624fcd45df37`

The PR body is the exact-head evidence ledger because updating this checkpoint itself creates a new documentation commit. The V1 production identity remains unchanged. This is a Next Version capability and must not be represented as `PRODUCTION_VERIFIED` until every external provider and delivery gate below has real evidence.

## Canonical architecture

The implementation does not create email-specific Conversation or Message abstractions.

Email thread state references the canonical CRM `ConversationRecord` / `crm_conversations`, and every inbound/outbound message references the canonical CRM `MessageRecord` / `crm_messages` introduced by PR #22.

Bounce, complaint, unsubscribe and provider opt-out observations are reconciled through the canonical Privacy capability `privacy.provider_consent.reconcile` from PR #19. `email_provider_events` is immutable provider evidence only; it is not a second consent or suppression ledger.

Outbound execution remains gated by the existing Omnichannel contracts for resolved ContactRecord identity, canonical Privacy suppression/consent state, policy decision and Approval.

## Implemented scope

- SendGrid v3 Mail Send adapter.
- Sender/domain configuration and read-only credential/domain validation.
- API key through the existing `SecretResolver` contract.
- SPF, DKIM and DMARC DNS evidence checks.
- Versioned email templates.
- Canonical Conversation/thread mapping using `Message-ID`, `In-Reply-To` and `References`.
- Signed SendGrid Event Webhook verification and normalization.
- Signed Inbound Parse verification/normalization and ingestion into canonical CRM records.
- Inbound Parse is explicit/optional. When enabled it requires a receiving hostname and signing key, and preflight validates MX routing to `mx.sendgrid.net`.
- Delivery lifecycle: prepared, submitted, accepted, processed, delivered, deferred, bounced, complaint, unsubscribed, dropped, failed and unknown.
- Provider suppression readback for global unsubscribe, bounce and spam report.
- Durable dispatch idempotency enforced before provider execution.
- Durable PostgreSQL rate-limit buckets enforced before provider execution.
- Bounded retry with provider `Retry-After` honored for transient failures and exponential fallback when absent.
- Provider rejection bodies are not embedded in persisted retry/error codes.
- Attachment metadata/digest/reference persistence and validation.
- Reputation/statistics readback.
- Independent Email Activity readback when the account exposes activity history.
- Provider event deduplication using provider event identifiers.
- Bounce/complaint/unsubscribe reconciliation into canonical Privacy.
- Open/click tracking disabled on send unless both Privacy and Policy explicitly authorize tracking.
- Open/click events discarded on ingest when current Privacy or Policy authorization does not permit tracking.
- No SendGrid suppression bypass setting is emitted.

## CI evidence for the clean implementation

The clean implementation commit was exercised as PR #23 merge ref `d54550e6ad67adf739437e9e3c311eb371e29f61` over CRM base `be97c0a6249876ff306a67158ae35e94c217bd6d`.

Email Provider Gate run `32336964937`: `PASS`.

- Prettier: PASS.
- ESLint: PASS.
- Email typecheck: PASS.
- Vitest: 3/3 files PASS, 25/25 tests PASS.
  - `test/email-runtime.test.ts`: 8/8.
  - `test/email-orchestrator.test.ts`: 9/9.
  - `test/sendgrid-email-provider.test.ts`: 8/8.
- Stacked repository typecheck: PASS.
- Stacked repository build: PASS.

Quality Gate run `32336964982`: `PASS`.

- workflow supply-chain verification: PASS.
- format: PASS.
- architecture: PASS.
- lint: PASS.
- typecheck: PASS.
- tests: PASS.
- build: PASS.

M-FOUND-12 PostgreSQL E2E run `32336964932`: `PASS`.

- real repository migrations applied successfully.
- PostgreSQL restart/outbox/audit, CRM Sales, worker restart safety and Video/R29 E2E: PASS.
- migration drift check: PASS.

Temporary sync/rebuild PRs #32, #34 and #35 were closed without merge. Temporary hardening/rebuild workflows were removed from the reconstruction branch. The official PR contains one clean implementation commit plus this checkpoint refresh only.

## Production validation gate

Run the read-only preflight only after the real environment is configured:

```bash
pnpm tsx scripts/validate-sendgrid-email.ts
```

The preflight must return `pass: true` for all applicable gates:

1. API credentials accepted by SendGrid.
2. Configured sender matches the configured sending domain.
3. Sending domain exists in SendGrid Domain Authentication.
4. SendGrid reports the authenticated domain as valid.
5. SPF evidence passes.
6. DKIM evidence passes against configured provider records.
7. DMARC exists and passes the DNS check.
8. Event Webhook public key is configured.
9. When inbound email is enabled, the receiving hostname is configured, MX resolves to `mx.sendgrid.net`, and the Inbound Parse signing key is configured.
10. Independent Email Activity/provider readback is enabled.

The preflight sends no email, changes no DNS records and changes no suppression state.

## Real end-to-end evidence still required

Before `PRODUCTION_VERIFIED`, capture evidence for:

- one approved outbound message to a controlled recipient;
- SendGrid acceptance receipt and provider message ID;
- independent provider readback for the same message;
- delivered Event Webhook with valid signature;
- bounce event on a controlled test address and canonical Privacy suppression reconciliation;
- complaint/spam-report handling where a safe provider-supported test path exists;
- unsubscribe/group-unsubscribe and canonical Privacy reconciliation;
- retry/readback behavior for a controlled transient failure or documented synthetic fixture;
- inbound Parse to the receiving hostname, signature validation, canonical Contact resolution, canonical Conversation mapping and canonical MessageRecord append when inbound is enabled;
- attachment ingress/egress within configured limits;
- durable rate-limit enforcement;
- open/click ingestion only under an explicitly authorized Privacy + Policy state;
- reputation/statistics readback after the controlled send.

## Required external configuration

No sender/domain or credential was found in the canonical Drive material inspected for this front. Therefore this PR intentionally leaves the provider binding fail-closed.

Required deployment values are documented in `.env.example`. The API key itself must remain in the configured secret provider and must never be committed.

For `gcp-secret-manager` with the current environment resolver, `EMAIL_SENDGRID_API_KEY_SECRET_KEY=SENDGRID_API_KEY` resolves from runtime binding `TOCA_SECRET_SENDGRID_API_KEY`.

## Merge ordering

1. Finish and merge PR #19 (canonical Privacy communication/provider reconciliation).
2. Finish and merge PR #22 (canonical CRM Conversation/Message and persistence).
3. Refresh PR #23 to the resulting `main` if required and resolve only genuine integration drift.
4. Re-run exact-head Quality + Email Provider Gate + PostgreSQL E2E after final parent integration.
5. Configure the real SendGrid account/domain/secrets without promoting the binding.
6. Run the read-only provider/DNS preflight.
7. Execute the controlled real Email E2E matrix and capture provider readback.
8. Promote Email capabilities/binding only after all evidence is attached and audited.
