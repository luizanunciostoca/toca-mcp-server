# P2.1 — Google Ads real provider

Date: 2026-08-28

Status: **CI_VERIFIED / BLOCKED_EXTERNAL_CREDENTIAL_AND_ACCOUNT_BINDING**

## Scope

P2.1 requires a real Google Ads provider under R28. The route model remains provider-neutral and there is no R33.

The allowed lifecycle remains:

`OFF -> READ_ONLY -> PREPARE -> CREATE_PAUSED -> READBACK -> MANAGE`

No phase may be skipped. `CREATE_PAUSED` does not authorize activation, delivery, budget mutation, or spend.

## Code and CI state

The repository already contains the real Google Ads REST client, account verifier, paid-media provider, phase-gated runtime, and `src/google-ads-provider-read-smoke.ts`.

Run `33205910481` executed the full Quality Gate successfully on branch `ops/p2-1-google-ads-provider-20260828`:

- 217 test files passed / 17 skipped;
- 1047 tests passed / 25 skipped;
- format, architecture, lint, typecheck, tests and build passed.

The workflow then failed closed at configuration preflight before any Google Ads network call because the production Google Ads credential/account bindings were not materialized in the workflow environment.

## GCP provider-binding discovery

WIF authentication to `toca-mcp-production` succeeded using `toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`.

The deployer correctly lacks broad `secretmanager.secrets.list`; no permission escalation was applied merely to discover credentials.

A subsequent read-only candidate probe completed in run `33206214007` and proved:

- Cloud Run service: `toca-mcp-production`;
- runtime service account: `toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`;
- `GOOGLE_ADS_PHASE=OFF`;
- `GOOGLE_ADS_PROVIDER_VERIFIED=false`;
- no secret values were read;
- no provider mutation was executed.

Conventional candidate secret IDs for developer token, OAuth client ID/secret, and refresh token were not present under the tested names.

Evidence artifact: `p2-1-google-ads-binding-probe-33206214007`, artifact ID `9699765736`, SHA-256 `f82bcf24f18d8f890548fa0c9b4c1f3df0c85587f132edc45ff6e197dbe3f529`.

## External blocker

The remaining gate is factual external input, not code:

- Google Ads developer token;
- OAuth client ID;
- OAuth client secret;
- OAuth refresh token with access to the target customer;
- target customer ID and optional login-customer/MCC ID;
- factual currency, budget ceiling and targeting allowlists.

Secret values must live only in Secret Manager or another approved secret boundary. They must never be committed to Git, Drive, Issues, logs, or chat.

## Closure criterion

After the bindings exist, rerun the real provider READ smoke. P2.1 can be promoted to `CLOSED / PROVIDER_VERIFIED_READ_ONLY` only when the Google Ads API itself proves accepted developer token/OAuth, accessible customer, verified account/currency, real account/campaign/insight/conversion reads, deterministic PREPARE, targeting validate-only with `sideEffects=false`, and zero mutation/spend.

Any future `CREATE_PAUSED` is a separate mutational approval gate and must use an immutable prepared descriptor plus explicit approval. `MANAGE`/`ACTIVATE` is not authorized by this P2.1 read-only closure.
