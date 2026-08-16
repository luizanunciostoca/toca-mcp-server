# Meta Ads Provider Settlement Readiness v2

Status: **PRIMARY PREPARE VALIDATED / CREATE_PAUSED PENDING — NO WRITE / NO SPEND**

Current reconciliation baseline: `main@808454749b1d56ae7c42a1f7cc543959da1ef391`.

This checkpoint records the controlled Meta Ads provider-settlement path without widening the public MCP surface or enabling generic provider writes.

## Preserved behavior

- `IN_PROCESS`, `PENDING_REVIEW` and `PREAPPROVED` are transient, not success;
- campaign/ad set/ad configured status must remain `PAUSED`;
- provider `WITH_ISSUES`, unsafe effective states, `issues_info` and `failed_delivery_checks` fail closed;
- provider read-back is polled to a bounded settled state before the smoke may record success;
- exact account must be active and currency-bound;
- exact Pixel must be accessible through an available Business and assigned to the selected ad account;
- final Ad payload receives a provider `validate_only` preflight against a usable existing Ad Set;
- expired, nearly expired or invalid-dated Ad Sets are rejected before the validate-only provider call;
- a validate-only response that unexpectedly returns an Ad ID is rejected;
- source creative normalization removes provider actor bindings before rebuilding the controlled creative;
- no activation path is introduced and no test may consume ad spend.

## Historical provider evidence — superseded account

An earlier provider PREPARE was executed against ad account `394512749760530` with public MCP Meta Ads writes explicitly verified disabled before the provider call.

GitHub Actions run: `31914813896`.

The PREPARE Cloud Run Job reached Meta's real `validate_only` path and failed closed with:

- HTTP `400`;
- Meta code `100`;
- Meta subcode `1359188`;
- type `OAuthException`;
- provider reason: the ad account required a valid payment method in Meta Billing & Payments.

No campaign, ad set, creative or ad was created, no activation occurred, no retry was issued, and no spend was possible. This result is immutable historical evidence for `394512749760530`; that account is no longer the operational Meta Ads target.

## Primary account transition — 2026-08-15

The operational Meta Ads primary account is `311793958882290`. The canonical campaign plan, permanent provider-validation workflow, approval fixtures and regression tests are bound to this account. A regression test prevents code/workflow account drift.

The following provider bindings remain unchanged:

- Facebook Page `306103746115875`;
- Instagram actor `17841402033495654`;
- Pixel `461233076843065`;
- currency `BRL`;
- controlled smoke daily budget `17000` minor units;
- maximum daily budget guardrail `100000` minor units.

Public MCP Meta Ads writes remain disabled. PREPARE and EXECUTE remain separate, exact-plan/hash-bound operations with zero Cloud Run retries.

## Fresh primary-account PREPARE evidence — PASS

A fresh exact-code PREPARE was executed against primary account `311793958882290` after the account migration and after fixing the preflight selector so expired existing Ad Sets cannot be used for validate-only validation.

GitHub Actions run: `31920334418`.

Result: `META_ADS_PRIMARY_PREPARE=PASS`.

Sanitized provider proof:

- source main: `808454749b1d56ae7c42a1f7cc543959da1ef391`;
- account ID: `act_311793958882290`;
- account currency: `BRL`;
- account status: active provider status `1`;
- granted scopes include `ads_management`, `ads_read` and `business_management`;
- Pixel `461233076843065` (`Pixel Toca do Morcego`) is assigned to account `311793958882290`;
- provider no-side-effect write-readiness validation: `validated=true`;
- usable validation Ad Set: `52617499501065`;
- source creative: `24628562856774168`;
- exact prepared request SHA-256: `12521543d2d7a3188d0cd06ed2aa732cc1f9f769eaf55eaf96ddb7073ae97f62`;
- provider geo remained bound to the controlled Morro de São Paulo target;
- sanitized evidence artifact ID: `9256189550`;
- artifact digest: `sha256:a74fcbdb347698df393f53c76c4ed1d43cc4023e8f8dd797e1557bd1a0858f25`.

The old billing error `1359188` did **not** recur on the primary account. The fresh PREPARE reached and passed the final no-side-effect provider validation. No campaign, ad set, creative or ad was created, no activation occurred, no provider mutation retry was issued and no spend occurred.

## Expired-Ad-Set preflight hardening

The first PREPARE attempt on `311793958882290` exposed a separate provider preflight defect: the selector chose existing Ad Set `52617508751065`, which had already expired. Meta rejected that validate-only request with code `100`, subcode `3858750`.

PR #132 fixed this without widening write capability:

- provider candidate reads now include `end_time`;
- expired and invalid-dated Ad Sets are rejected;
- Ad Sets ending within five minutes are rejected as unsafe validation references;
- evergreen Ad Sets with no end time remain eligible;
- no eligible Ad Set causes fail-closed `META_ADS_SMOKE_VALIDATE_ONLY_ADSET_NOT_FOUND` before provider POST;
- deterministic tests cover expiration and invalid-date behavior.

PR #132 exact-head Quality passed and was fixed-head merged. Post-merge `main@808454749b1d56ae7c42a1f7cc543959da1ef391` Quality run `31920308690` is **SUCCESS**.

## Provider evidence boundary

The current primary account now has fresh provider proof for:

1. granted `ads_management` permission;
2. exact active ad account + `BRL` currency;
3. Pixel assignment to that account;
4. successful no-side-effect `validate_only` preflight with no created Ad ID.

This is sufficient to close the PREPARE readiness gate. It does **not** promote `meta_ads.campaign.create_paused` to production-validated write status because no provider mutation was performed.

The remaining controlled sequence is:

5. explicit approved `CREATE_PAUSED` descriptor/hash bound to the exact prepared plan;
6. one bounded provider mutation with no activation;
7. settled provider read-back with campaign/ad set/ad remaining safely paused and with no issues/delivery failures;
8. immutable audit evidence;
9. zero activation and zero spend.

Until that write-and-readback sequence succeeds, lifecycle remains **IMPLEMENTED / PREPARE VALIDATED / CREATE_PAUSED PROVIDER SETTLEMENT PENDING**.

## Merge and safety gate

The account migration and expired-Ad-Set hardening are merged and Quality-green. The historical billing blocker belongs only to superseded account `394512749760530` and must not be represented as a current blocker for primary account `311793958882290`.

`CREATE_PAUSED` remains a separate controlled operation. It must use the exact prepared descriptor/hash, remain PAUSED-only, use zero mutation retries and require provider settlement/read-back. Activation and spend are not authorized by this checkpoint.
