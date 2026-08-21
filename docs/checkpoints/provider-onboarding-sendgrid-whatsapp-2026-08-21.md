# Provider onboarding — SendGrid + WhatsApp — 2026-08-21

## Purpose

Record exact provider-onboarding evidence without exposing secret values, without altering provider architecture, and without promoting provider/staging/production lifecycle state.

## Revalidated baseline

- Repository: `luizanunciostoca/toca-mcp-server`.
- Initial audit base: `main@5f128222a03683ce6da83426969644f189300409`.
- Current main during closeout: `844281fca7abdbcaf413f9dd5720ce485acbef5a` (`#62`, staging resource-name isolation only).
- Canonical TOCA_OS capability catalog revalidated on 2026-08-21:
  - `email.campaign.send`: `PLANNED`, `CATALOG_ONLY`, `PROVIDER_VERIFIED=false`, `PRODUCTION_VERIFIED=false`.
  - `whatsapp.message.send`: `PLANNED`, `CATALOG_ONLY`, `PROVIDER_VERIFIED=false`, `PRODUCTION_VERIFIED=false`.
- Concurrent composition PRs `#66` (Email) and `#67` (WhatsApp) were open and unmerged during this audit. Their branch state is not production/provider evidence.

Therefore no real Email or WhatsApp outbound send was permitted by this audit.

## SendGrid — current provider-verification state

### Implementation facts already present

The canonical SendGrid provider supports:

- sender/domain configuration;
- Domain Authentication read;
- SPF/DKIM/DMARC preflight;
- signed Event Webhook verification;
- Event Webhook public-key autodiscovery;
- optional exact expected-URL selector;
- ambiguity fail-closed when multiple signed enabled webhooks are eligible without a selector;
- Email Activity API authoritative readback;
- suppression reads/reconciliation surfaces;
- statistics/reputation reads;
- bounded retry/rate-limit handling;
- send acceptance contract requiring HTTP 202 plus `x-message-id` when a governed real send is allowed.

These implementation facts do not constitute provider verification.

### Exact current evidence

Combined read-only onboarding run:

- workflow run: `32453502570`
- job: `96686252286`
- artifact: `9436431334`
- artifact name: `provider-onboarding-email-whatsapp-read-ddf00014905eefa9acc9f5ac5c77151487d4039d`
- artifact digest: `sha256:7e09690642290c3604eea98fbf9472aaa4d3ddc6079460190a0e1ac47f03fc96`
- result: `BLOCKED_CONTROL_PLANE_CONFIG`
- provider call executed: **no**
- provider write executed: **no**
- Email send executed: **no**
- lifecycle promotion: **no**

The GitHub `production` environment did not expose the control-plane variables required by the current deploy/provider verification contract. The exact missing names were:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GCP_ARTIFACT_REPOSITORY`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_DEPLOY_SERVICE_ACCOUNT`
- `GCP_RUNTIME_SERVICE_ACCOUNT`
- `GCP_META_ACCESS_TOKEN_SECRET`
- `GCP_META_ACCESS_TOKEN_SECRET_VERSION`
- `GCP_SENDGRID_API_KEY_SECRET`
- `GCP_SENDGRID_API_KEY_SECRET_VERSION`
- `EMAIL_SENDGRID_SENDING_DOMAIN`
- `EMAIL_SENDGRID_FROM_EMAIL`

A separate secret-metadata-only discovery proved that the previously documented production WIF/deployer can still authenticate to GCP, but the deployer intentionally does not have broad `secretmanager.secrets.list` permission:

- workflow run: `32452963873`
- job: `96684693669`
- artifact: `9436255732`
- artifact digest: `sha256:4180d5547fbe6b0a4586176f0bf488fba38fa284966ef108e254299b59e09a63`
- exact denied permission: `secretmanager.secrets.list`
- secret values read: **no**
- provider APIs called: **no**

This audit did not broaden IAM merely to discover an unknown SendGrid secret ID. Canonical Drive material and the existing SendGrid checkpoint do not contain a production SendGrid API-key secret reference, sender, or sending domain.

### SendGrid verdict

`PROVIDER_VERIFIED=false` remains correct.

The following requested live evidence is still unproven because the credential/sender/domain control-plane package is absent from the accessible canonical configuration:

- API-key acceptance;
- authenticated sending domain;
- live SPF/DKIM/DMARC status;
- live Event Webhook selection/public key;
- Email Activity API access;
- controlled HTTP 202 / `x-message-id` send;
- delivered signed-event readback;
- controlled bounce;
- suppression reconciliation after live events;
- unsubscribe/complaint behavior;
- live rate-limit/retry observation;
- account reputation/statistics.

No real send may be executed until both the provider package is available and `email.campaign.send` is technically integrated into the canonical runtime with the required Approval/Policy gates.

## WhatsApp — current provider-verification state

### Exact live read-only provider evidence

Current live Meta verification used the existing production runtime identity and mounted the existing Meta token from Secret Manager only inside a temporary Cloud Run Job.

- workflow run: `32453386657`
- job: `96685915939`
- source head: `5a802c85a09442f3ad622bfb3d86e61bf7410f41`
- verified at: `2026-08-21T06:12:26.860Z`
- runtime identity: `toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`
- secret reference: `gcp-secret:toca-meta-oauth-token:latest`
- immutable probe image digest: `sha256:f202fba662fc7cd79d874a12f074f337d851eb015773d31424ad0d5901c3143f`
- evidence artifact: `9436418460`
- artifact name: `whatsapp-provider-read-5a802c85a09442f3ad622bfb3d86e61bf7410f41`
- artifact digest: `sha256:156dd9bf1a7a1cf0934757b9beac8bc8191bf7bf9e01761071aab98ab3b37e15`
- result: `READ_PREFLIGHT_BLOCKED`

Observed provider gates:

- Meta token accepted: **PASS** (`/me/permissions` HTTP 200).
- `whatsapp_business_management`: **MISSING**.
- `whatsapp_business_messaging`: **MISSING**.
- Business enumeration: **PASS** (`/me/businesses` HTTP 200).
- Business selection: **AMBIGUOUS** because two Business Managers are visible:
  - `1123355242505391` — `Toca do Morcego - Luiz`
  - `232421267344387` — `Toca do Morcego`
- Business `1123355242505391` owned-WABA read: HTTP 403.
- Business `1123355242505391` client-WABA read: HTTP 403.
- Business `232421267344387` owned-WABA read: HTTP 403.
- Business `232421267344387` client-WABA read: HTTP 403.
- WABA selection: not possible.
- Phone Number ID discovery: not possible.
- template enumeration/APPROVED template verification: not possible.

The four WABA 403 responses are consistent with the missing WhatsApp management permission. No canonical TOCA_OS material identifies which of the two Business IDs must be selected, so the ambiguity remains fail-closed rather than guessed.

Safety invariants captured by the artifact:

- provider writes: **false**
- WhatsApp message sent: **false**
- webhook mutated: **false**
- template mutated: **false**
- lifecycle promoted: **false**

### WhatsApp verdict

`PROVIDER_VERIFIED=false` remains correct.

Before any controlled outbound can be considered, the credential package must be reauthorized with both required WhatsApp permissions and the canonical Business selector must be supplied. Only then can the existing Business -> WABA -> Phone discovery continue to Phone Number ID and APPROVED template/locale/variable validation.

The requested inbound/outbound evidence (`Contact/Conversation/Message`, governed Approval send, `wamid`, signed callback, `SENT`, `DELIVERED`, optional `READ`, opt-out reconciliation, 24h service window, template outside window, retry/throttle) was deliberately not executed because `whatsapp.message.send` remained `PLANNED/CATALOG_ONLY` in canonical TOCA_OS and the provider preflight itself failed before WABA/Phone resolution.

## Configuration reconciliation found by this audit

The provider config schema/example now explicitly includes non-secret selectors that the canonical runtime already understands but that were absent from `.env.example`:

- `WHATSAPP_BUSINESS_ID`
- `EMAIL_SENDGRID_EVENT_WEBHOOK_URL`

The production deployment/control-plane still needs to bind the corresponding variables deliberately; no selector, secret ID, sender, domain, or credential value was guessed by this audit.

## Lifecycle closeout

- SendGrid: `PROVIDER_VERIFIED=false`; `STAGING_VERIFIED=false`; `PRODUCTION_VERIFIED=false`.
- WhatsApp: `PROVIDER_VERIFIED=false`; `STAGING_VERIFIED=false`; `PRODUCTION_VERIFIED=false`.
- No real Email send.
- No real WhatsApp send.
- No provider write.
- No secret value exposed.
- No architecture/domain/provider abstraction added.
- Temporary verification workflows/scripts were removed after immutable evidence artifacts were captured.
