# Real Email / Twilio SendGrid — implementation checkpoint

Date: 2026-08-20

## State

- Implementation: `IMPLEMENTED`
- Email-owned CI verification: `PASS`
- Stacked repository integration: `BLOCKED_BY_CRM_BASE`
- Provider validation: `PENDING_EXTERNAL_CONFIGURATION`
- Production promotion: `NOT_ALLOWED`
- Provider: Twilio SendGrid
- Email PR: #23
- CRM dependency: PR #22
- Privacy dependency: PR #19
- Exact verified Email branch HEAD: `e7dbcefc9d8e69c80fd285f80f341df4f093decd`
- Exact verified PR merge ref: `7f2596b76cda38f45ba9add478a05eb03af5149a`

The V1 production identity remains unchanged. This is a Next Version capability and must not be represented as `PRODUCTION_VERIFIED` until every provider and delivery gate below has real evidence.

## Canonical architecture

The implementation does not create email-specific Conversation or Message abstractions.

Email thread state references the canonical CRM `ConversationRecord` / `crm_conversations`, and every inbound/outbound message references the canonical CRM `MessageRecord` / `crm_messages` introduced by PR #22.

Bounce, complaint, unsubscribe and provider opt-out observations are reconciled through the canonical Privacy capability `privacy.provider_consent.reconcile` from PR #19. `email_provider_events` is immutable provider evidence only; it is not a second consent or suppression ledger.

Outbound execution remains gated by the existing Omnichannel contracts for resolved ContactRecord identity, canonical Privacy suppression/consent state, policy decision and Approval.

## Implemented scope

- SendGrid v3 Mail Send adapter.
- Sender/domain configuration.
- API key through the existing `SecretResolver` contract.
- Read-only credential and authenticated-domain validation.
- SPF, DKIM and DMARC DNS evidence check.
- Versioned email templates.
- Canonical Conversation/thread mapping using `Message-ID`, `In-Reply-To` and `References`.
- Signed SendGrid Event Webhook verification and normalization.
- Signed Inbound Parse verification/normalization and ingestion into canonical CRM records.
- Delivery lifecycle: prepared, submitted, accepted, processed, delivered, deferred, bounced, complaint, unsubscribed, dropped, failed and unknown.
- Provider suppression readback for global unsubscribe, bounce and spam report.
- Durable dispatch idempotency enforced before provider execution.
- Bounded exponential retry/defer for transient provider failures.
- Durable PostgreSQL rate-limit buckets enforced before provider execution.
- Attachment metadata/digest/reference persistence and validation.
- Reputation/statistics readback.
- Independent Email Activity readback when the SendGrid activity-history capability is enabled on the account.
- Provider event deduplication using the provider event identifier.
- Bounce/complaint/unsubscribe reconciliation into canonical Privacy.
- Open/click tracking disabled on send unless both Privacy and Policy explicitly allow the requested tracking.
- Open/click events discarded on ingest when current Privacy or Policy authorization does not permit tracking.
- No SendGrid suppression bypass setting is emitted.

## Exact CI evidence

Email Provider Gate run `32335629079`, job `96324540524`, against PR merge ref `7f2596b76cda38f45ba9add478a05eb03af5149a`:

- Prettier: PASS.
- ESLint: PASS.
- Email-owned typecheck: PASS under the stack-aware verifier. The only transitive TypeScript diagnostics were in the CRM base file `src/crm/runtime.ts`; no Email-owned file emitted a diagnostic.
- Vitest: 3/3 files PASS, 22/22 tests PASS.
  - `test/email-runtime.test.ts`: 8/8.
  - `test/email-orchestrator.test.ts`: 8/8.
  - `test/sendgrid-email-provider.test.ts`: 6/6.

The separate stacked repository integration job intentionally remains red while PR #22 is red. Whole-repository diagnostics are currently confined to `src/crm/runtime.ts` and `src/persistence/postgres-crm-sales-store.ts` from the CRM base. The global Quality Gate is also blocked before Email checks by a malformed concurrent/base workflow `.github/workflows/m-found-12-postgres-e2e.yml`.

These inherited failures are not waived for release. PR #23 remains draft and cannot be promoted until the base is green and the exact refreshed Email head passes the normal repository gates.

## Production validation gate

Run the read-only preflight only after the real environment is configured:

```bash
pnpm tsx scripts/validate-sendgrid-email.ts
```

The preflight must return `pass: true` for all of the following:

1. API credentials accepted by SendGrid.
2. Configured sender matches the configured sending domain.
3. Sending domain exists in SendGrid Domain Authentication.
4. SendGrid reports the authenticated domain as valid.
5. SPF evidence passes.
6. DKIM evidence passes against the configured provider records.
7. DMARC exists and passes the DNS check.
8. Event Webhook public key is configured.
9. Inbound Parse public key is configured when inbound email is enabled.
10. Independent Email Activity readback is enabled.

The preflight sends no email, changes no DNS records and changes no suppression state.

## Real end-to-end evidence still required

Before `PRODUCTION_VERIFIED`, capture evidence for:

- one approved outbound message to a controlled recipient;
- SendGrid acceptance receipt and provider message ID;
- provider readback for the same message;
- delivered Event Webhook with valid signature;
- bounce event on a controlled test address and canonical Privacy suppression reconciliation;
- complaint/spam-report handling where a safe provider-supported test path exists;
- unsubscribe/group-unsubscribe and canonical Privacy reconciliation;
- retry/readback behavior for a controlled transient failure or documented synthetic fixture;
- inbound Parse to the receiving subdomain, signature validation, canonical Contact resolution, canonical Conversation mapping and canonical MessageRecord append;
- attachment ingress/egress within configured limits;
- rate-limit enforcement;
- open/click ingestion only under a purpose/policy combination that explicitly permits tracking;
- reputation/statistics readback after the controlled send.

## Required external configuration

No sender/domain or credential was found in the canonical Drive material inspected for this front. Therefore this PR intentionally leaves the provider binding fail-closed.

Required deployment values are documented in `.env.example`. The API key itself must remain in the configured secret provider and must never be committed.

For `gcp-secret-manager` with the current environment resolver, `EMAIL_SENDGRID_API_KEY_SECRET_KEY=SENDGRID_API_KEY` resolves from the runtime binding `TOCA_SECRET_SENDGRID_API_KEY`.

## SendGrid references used for implementation

- Mail Send: https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
- Domain Authentication: https://www.twilio.com/docs/sendgrid/api-reference/domain-authentication/list-all-authenticated-domains
- Suppressions: https://www.twilio.com/docs/sendgrid/ui/sending-email/index-suppressions
- Event Webhook security: https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features
- Inbound Parse: https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook

## Merge ordering

1. Finish and merge PR #19 (canonical Privacy communication/provider reconciliation).
2. Finish and merge PR #22 (canonical CRM Conversation/Message and persistence).
3. Rebase/refresh PR #23 to the resulting `main` and resolve only genuine integration drift.
4. Obtain exact-head Quality + Email Provider Gate + PostgreSQL E2E evidence.
5. Configure the real SendGrid account/domain/secrets without promoting the binding yet.
6. Run the read-only provider/DNS preflight.
7. Execute the controlled real Email E2E matrix and capture provider readback.
8. Promote Email capabilities/binding only after all evidence is attached and audited.
