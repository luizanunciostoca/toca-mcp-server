# Privacy/LGPD runtime final revalidation — 2026-08-20

Scope: execution-time Privacy revalidation for Email and WhatsApp outbound paths.

The implementation reuses the canonical PrivacyGovernanceService and existing consent/suppression ledger. Email and WhatsApp re-read contactability immediately before provider execution, including retry/deferred wake-up, so consent revocation, unsubscribe, complaint or suppression after scheduling prevents the external send.

No provider adapter, migration, parallel consent store or provider side effect is introduced by this change.

The clean replacement branch was rebuilt from current main after the earlier development history contained a deterministic test idempotency string that Gitleaks classified as a generic API key. The fixture was changed to a low-entropy test marker; no Gitleaks allowlist or security-gate relaxation was added.

Promotion remains evidence-gated: this checkpoint claims implementation/CI evidence only after exact-head Quality, Security Supply Chain, Email Provider Gate and PostgreSQL E2E succeed. It does not claim PROVIDER_VERIFIED or PRODUCTION_VERIFIED.
