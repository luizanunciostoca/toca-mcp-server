# Google Ads provider verification — 2026-08-20

## Scope

Provider-verification attempt for the existing TOCA OS Next Google Ads integration. This record does not promote any lifecycle state and does not contain secret values.

- repository: `luizanunciostoca/toca-mcp-server`
- live `main` revalidated at: `47348e0608bd3936fc1419fa495e8b6761489934`
- Google Ads integration commit present in main: `b2257d483af3fb33f9a2365713063f6e49559c17`
- verification observation timestamp: `2026-08-20T20:21:42-03:00`
- provider mutation executed: `false`
- campaign activation executed: `false`
- spend generated for verification: `false`

## Lifecycle verdict

| State | Verdict | Evidence |
| --- | --- | --- |
| `CI_VERIFIED` | retained | PR #28 exact-head evidence recorded Quality Gate `32337044377` SUCCESS and PostgreSQL E2E `32337044338` SUCCESS; the integration was subsequently merged as `b2257d4...`. |
| `PROVIDER_VERIFIED` | **NOT PROMOTED** | no authorized live Google Ads API READ was reachable through the deployed Core with verifiable credentials/configuration in this verification attempt. |
| `PRODUCTION_VERIFIED` | **NOT PROMOTED** | provider verification is not satisfied and no production mutation/readback proof exists. |

## Repository evidence

The provider path is implemented and fail-closed:

- `GOOGLE_ADS_PHASE` defaults to `OFF` and supports `READ_ONLY -> PREPARE -> CREATE_PAUSED -> READBACK -> MANAGE`.
- Developer Token is mandatory whenever Google Ads is not `OFF`.
- OAuth refresh mode requires client ID, client secret and refresh token references together; static access token and OAuth refresh are mutually exclusive.
- customer ID and allowed customer ID must match.
- `CREATE_PAUSED` requires persistent DB configuration.
- activation has a separate `GOOGLE_ADS_ACTIVATE_ENABLED` kill switch and requires `MANAGE`.
- `google_ads.campaign.create_paused` is `WRITE_EXTERNAL`; `google_ads.campaign.activate` is `FINANCIAL_IMPACT`.
- provider readback supports exact Google Ads `request-id` capture and campaign status verification.

## Minimum capability review requested for this gate

| Required capability | Current canonical runtime equivalent | Result |
| --- | --- | --- |
| inspect | `google_ads.account.inspect` | present |
| list | `google_ads.campaigns.list` | present |
| insights | `google_ads.insights.get` | present |
| get | no distinct campaign-get capability found; campaign-specific lookup currently exists as readback | **gap** |
| prepare | `google_ads.campaign.prepare` | present |
| list prepared | no persisted/list-prepared capability found | **gap** |
| create_paused | `google_ads.campaign.create_paused` | present |
| readback | `google_ads.campaign.readback` | present |

Result: **6/8 exact minimum surfaces are represented**. `get` and `list prepared` must not be silently inferred from other capabilities for provider-verification promotion.

## Deployment / Secret Manager blocker

The current `deploy-gcp.yml` injects Database and Meta secrets/configuration but does not inject Google Ads phase, customer/login-customer IDs, Google Ads secret-reference environment variables, Developer Token, OAuth client credentials, refresh credential, or Google Ads guardrails.

As a result, the repository-defined standard Cloud Run deployment provides no auditable evidence that the deployed runtime has Google Ads enabled. Because `GOOGLE_ADS_PHASE` defaults to `OFF`, provider verification must remain fail-closed unless an independently verified deployed revision proves otherwise.

No Secret Manager read/control-plane integration was available in this verification context to prove that the required Google Ads secrets exist, are current, or are bound to the runtime service identity. No secret value was requested or exposed.

## TOCA_OS canonical drift

The current TOCA_OS capability spreadsheet returned no `google_ads` capability rows, while route `R28` is currently named `META_ADS_CONTROLLED_LIFECYCLE`. The repository, by contrast, contains Google Ads capabilities and historical R28 references.

This is a canonical drift and blocks lifecycle promotion until route/capability ownership is reconciled without duplicating Paid Media or Attribution.

## Phase 1 — immutable READ proof

**NOT EXECUTED.**

A valid Phase 1 proof requires an authorized call through TOCA Core using the real provider boundary, not an ad-hoc direct provider call. The deployed Core could not be proven configured for Google Ads from the current deployment source and available control-plane evidence.

Therefore these fields are intentionally absent rather than fabricated:

- Developer Token access level / permissible use: `NOT_PROVEN`
- OAuth credential validity / refresh success: `NOT_PROVEN`
- target Google Ads customer ID: `NOT_PROVEN`
- manager/login customer ID relationship: `NOT_PROVEN`
- account status: `NOT_PROVEN`
- billing setup status: `NOT_PROVEN`
- provider permission/read scope: `NOT_PROVEN`
- provider request IDs: `NONE_GENERATED`
- provider resource references: `NONE_GENERATED`
- provider response timestamps: `NONE_GENERATED`
- provider-backed Audit readback: `NONE_GENERATED`

## Phase 2 — CREATE_PAUSED + independent readback

**NOT EXECUTED.**

Prerequisites are not satisfied because Phase 1 provider evidence, deployed secret/config binding, canonical TOCA_OS reconciliation, and all requested minimum capability surfaces are incomplete.

No campaign was created, activated, or allowed to spend. No Approval was bypassed.

When eligible, Phase 2 must execute only through Core/Policy/Approval, create the campaign with provider status `PAUSED`, capture the mutation `request-id` and exact campaign resource name, then perform an independent READBACK through Core and prove the same resource remains `PAUSED`. `ACTIVATE` must remain disabled for this verification.

## Promotion blockers

1. Reconcile TOCA_OS route/capability truth for Google Ads without creating a parallel Paid Media route or Attribution domain.
2. Add/confirm exact `get` and persisted `list prepared` surfaces required by the provider-verification contract.
3. Bind Google Ads configuration and secret references to the target Cloud Run environment through Secret Manager using the runtime service identity and least privilege; do not commit secret values.
4. Set the verification environment to `GOOGLE_ADS_PHASE=READ_ONLY`; keep activation disabled.
5. Execute `account.verify`/`account.inspect` and the required immutable READs through Core and capture exact `request-id`, customer/account metadata, billing state and Audit readback.
6. Verify Developer Token access level/permissible use and OAuth/manager-account permissions from real provider evidence.
7. Only after Phase 1 succeeds, move the controlled verification environment to `CREATE_PAUSED`, obtain normal Approval, create exactly one PAUSED campaign, independently read it back as PAUSED, and record Audit evidence.
8. Do not promote `PRODUCTION_VERIFIED` until the production configuration, provider credentials, least privilege, observability/readback and governed runtime path have separate production evidence.

## Safety statement

No direct Google Ads provider call outside Core was made. No secret was exposed. No provider evidence was invented. No lifecycle status was promoted.