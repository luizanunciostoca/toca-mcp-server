# R28 Google Ads operational closeout

Date: 2026-08-16

Status: **BLOCKED_EXTERNAL_PROVIDER — RUNTIME_BINDING_ABSENT**

Scope: definitive provider-readiness closeout for the existing R28 Google Ads capability family only. This evidence does not create R33, does not add a domain, does not add an MCP tool, and does not widen the TOCA Core facade.

## Canonical repository state

- current `main`: `35b6aa15479a8a0c999b1260581e4ba7fd389f27`;
- PR #135 (`feat(R28): reconcile Google Ads through TOCA Core facade`) is merged; its merge commit is `0ffc2cf11c1f48894976676265ea3ebf3792ae87`, which is an ancestor of the current main;
- the only main change after that merge at reconciliation time is the unrelated Cloud SQL DR evidence commit `35b6aa15479a8a0c999b1260581e4ba7fd389f27`;
- the reconciled catalog contains **758 capabilities**, including the existing 13 `google_ads.*` capabilities under R28;
- public MCP surface remains exactly **12 TOCA Core tools**. Google Ads remains internal through the existing runtime capability resolver;
- official `Quality Gate` workflow id `330272942`, run `31924776669`, passed on `main@0ffc2cf11c1f48894976676265ea3ebf3792ae87` after the PR #135 merge. This evidence change requires a new exact-head Quality run before merge.

## Runtime/provider contract revalidated

The current Google Ads adapter uses Google Ads REST API v25 and requires:

- an OAuth access-token secret reference;
- OAuth scope `https://www.googleapis.com/auth/adwords`;
- a Google Ads developer-token secret reference;
- target customer id;
- optional `login-customer-id` when a manager hierarchy requires it;
- exact allowed-customer binding;
- account currency;
- approved daily budget ceiling in micros;
- currency minor-unit conversion in micros;
- allowed Google Ads location criterion ids;
- optional language criterion allowlist.

The mandatory provider rollout remains:

`OFF -> READ_ONLY -> PREPARE -> CREATE_PAUSED -> READBACK -> MANAGE`

No phase may be skipped merely to obtain write evidence.

## Real production runtime inspection

The production Cloud Run service was inspected through the existing GitHub -> Google Cloud Workload Identity Federation path using `toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`.

Observed production state:

- service: `toca-mcp-production`;
- latest ready revision: `toca-mcp-production-00045-hbz`;
- image: `southamerica-east1-docker.pkg.dev/toca-mcp-production/toca-mcp/server:toca-managed-daemon-0ffc2cf11c1f48894976676265ea3ebf3792ae87`;
- Google Ads environment / secret-reference entries on the production service: **none** (`googleAdsEnv=[]`).

Therefore production currently has no runtime binding for:

- `GOOGLE_ADS_PHASE`;
- `GOOGLE_ADS_CUSTOMER_ID`;
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` when required;
- `GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY`;
- `GOOGLE_ADS_DEVELOPER_TOKEN_ENV_KEY`;
- `GOOGLE_ADS_ALLOWED_CUSTOMER_ID`;
- `GOOGLE_ADS_ALLOWED_CURRENCY`;
- `GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS`;
- `GOOGLE_ADS_CURRENCY_MINOR_UNIT_MICROS`;
- `GOOGLE_ADS_ALLOWED_LOCATION_CRITERION_IDS`;
- `GOOGLE_ADS_ALLOWED_LANGUAGE_CRITERION_IDS` when used.

This is a provider/runtime configuration blocker, not a catalog or resolver blocker.

## Credential discovery boundary

The deployed GitHub/GCP identity can describe the production Cloud Run service, but `secretmanager.secrets.list` is denied for `toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`.

Consequences:

- no claim is made that Google Ads secrets do or do not exist elsewhere in Secret Manager;
- no credential value was exposed or copied;
- no orphaned secret was guessed by name;
- repository Actions secret/variable metadata also is not readable through the current GitHub integration and is not accepted as readiness evidence.

The minimum exact discovery/binding action now requires an administrator who can identify the intended credential and exact secret names, or grant a narrowly scoped mechanism that exposes only the required secret metadata/reference without exposing secret values.

## Provider READ result

A fail-closed operational probe checked runtime readiness before any Google Ads network call.

Result:

- runtime configuration complete: **false**;
- `google_ads.account.inspect`: **NOT EXECUTED**;
- `google_ads.campaigns.list`: **NOT EXECUTED**;
- `google_ads.insights.get`: **NOT EXECUTED**;
- `google_ads.conversion_actions.list`: **NOT EXECUTED**;
- reason: `RUNTIME_PROVIDER_CONFIGURATION_INCOMPLETE`.

This is intentional. The R28 contract forbids advancing to provider writes until live credential/scope/customer READs are correct.

## Write result

No Google Ads provider write was attempted.

- `google_ads.campaign.prepare`: not advanced to provider validation because the READ prerequisite is unresolved;
- `google_ads.campaign.create_paused`: **NOT EXECUTED**;
- campaign resource: none;
- campaign status: not applicable;
- provider spend caused by this closeout: **0**;
- `google_ads.campaign.readback`: not applicable because no campaign was created;
- `google_ads.campaign.activate`: **NOT EXECUTED / NOT AUTHORIZED**.

PR #135 explicitly does not authorize activation or a production budget update, and this closeout does not change that decision.

## Exact external remediation required

An authorized Google Ads / Google Cloud administrator must provide or bind the following facts without committing secret values:

1. Identify the intended Google Ads customer id and, if the customer is accessed through a manager account, the required login customer id.
2. Identify an OAuth identity that can access that customer and issue an access token containing `https://www.googleapis.com/auth/adwords`.
3. Identify the Google Ads developer token and confirm that its access level is valid for the intended non-test customer.
4. Confirm the Google Ads identity has sufficient account permissions for the required READ operations; before CREATE_PAUSED, confirm it also has campaign-create permission.
5. Confirm the customer account is enabled and obtain its real currency.
6. Confirm billing setup/status before the controlled CREATE_PAUSED step when provider data makes it available.
7. Store the OAuth token and developer token in approved secret storage and grant the production runtime identity only the exact secret-access permissions required for those two secret resources.
8. Bind the production runtime configuration listed above, first with `GOOGLE_ADS_PHASE=READ_ONLY`. The allowed customer must equal the target customer. Budget and location/language allowlists must be explicitly approved values for the smoke contract.
9. Re-run the real READ sequence and capture provider request ids/evidence.
10. Only after all READs are correct, advance to PREPARE/provider validate-only.
11. Only after PREPARE is correct, create one uniquely named SEARCH smoke campaign in `PAUSED`, with an approved bounded budget and approved location criteria. Do not activate it.
12. Read the exact campaign resource back, prove `PAUSED`, and query insights/spend to prove zero spend attributable to the smoke campaign.
13. Record durable approval/idempotency/audit/readback evidence before any lifecycle/runtime binding promotion.

No mock or fake provider result may satisfy these steps.

## Production classification

`GOOGLE ADS = BLOCKED_EXTERNAL_PROVIDER — RUNTIME_BINDING_ABSENT`

The implementation is reconciled inside R28 and the post-merge PR #135 Quality Gate is green, but `PRODUCTION_VERIFIED` is not truthful until the real credential/developer-token/customer binding exists and the mandatory live READ -> PREPARE -> CREATE_PAUSED -> READBACK sequence succeeds.
