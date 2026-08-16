# Meta Ads Provider Settlement Readiness v2

Status: **CODE READY / PROVIDER PREPARE BLOCKED BY META BILLING — NO WRITE / NO SPEND**

Current reconciliation baseline: `main@8bd2d2c1f1715fc1f054c38c8c95eaaa1648e1d8`.

This branch preserves the unique provider-settlement behavior from legacy PR #78 without rebasing its old workflow stack and without widening the public MCP surface.

## Preserved behavior

- `IN_PROCESS`, `PENDING_REVIEW` and `PREAPPROVED` are transient, not success;
- campaign/ad set/ad configured status must remain `PAUSED`;
- provider `WITH_ISSUES`, unsafe effective states, `issues_info` and `failed_delivery_checks` fail closed;
- provider read-back is polled to a bounded settled state before the smoke may record success;
- exact account must be active and currency-bound;
- exact Pixel must be accessible through an available Business and assigned to the selected ad account;
- final Ad payload receives a provider `validate_only` preflight against a usable existing Ad Set;
- a validate-only response that unexpectedly returns an Ad ID is rejected;
- source creative normalization removes provider actor bindings before rebuilding the controlled creative;
- no activation path is introduced and no test may consume ad spend.

## Executed provider evidence — 2026-08-15

Exact provider PREPARE was executed against ad account `394512749760530` with public MCP Meta Ads writes explicitly verified disabled before the provider call.

GitHub Actions run: `31914813896`.

The run passed repository Quality, GCP authentication, the production write-disabled assertion and immutable image build. The PREPARE Cloud Run Job then reached Meta's real `validate_only` path and failed closed with:

- HTTP `400`;
- Meta code `100`;
- Meta subcode `1359188`;
- type `OAuthException`;
- provider reason: the ad account must have a valid payment method configured in Meta Billing & Payments.

This is provider/billing state, not a repository validation failure. No campaign, ad set, creative or ad was created, no activation occurred, no retry was issued, and no spend was possible.

The provider write gate remains **BLOCKED_EXTERNAL_BILLING**. `CREATE_PAUSED` must not be executed until the same exact-code PREPARE succeeds after the billing state is corrected.

## Current code reconciliation evidence

The seven-file hardening delta was replayed cleanly onto the post-Privacy/post-Omnichannel main without restoring legacy workflow breadth.

- current base: `main@8bd2d2c1f1715fc1f054c38c8c95eaaa1648e1d8`;
- seven files only: controlled provider-validation workflow, settlement checkpoint, smoke entrypoint, provider preflight/readiness modules and focused tests;
- replay Quality run `31918195435`: **SUCCESS**;
- clean finalization Quality run `31918263236`: **SUCCESS**;
- this documentation-only evidence refresh re-triggers the canonical repository Quality Gate on the exact PR head.

The provider workflow remains manually dispatched, asserts public MCP Meta Ads writes are disabled, uses zero Cloud Run retries, separates PREPARE from EXECUTE, and requires exact smoke ID/request hash/plan payload before any future `CREATE_PAUSED` mutation.

## Why this replaces legacy #78

PR #78 is based on a substantially older Foundation state and includes branch-era smoke/diagnostic workflow changes. Current `main` already owns the canonical Meta Ads controlled-write service, guardrails and smoke entrypoint. Reusing those boundaries and porting only the missing settled-readiness primitives avoids a parallel Paid Media subsystem and avoids restoring temporary CI breadth.

## Provider evidence boundary

Historical provider evidence from #78 identified the canonical relationship between the intended ad account and Pixel and exposed a billing/payment gate during final Ad validation. The 2026-08-15 execution reproduced that gate on the current clean implementation. This is valid fail-closed evidence but does not make `meta_ads.campaign.create_paused` `PRODUCTION_VALIDATED`.

A future controlled provider run must still prove, on the exact current code:

1. granted `ads_management` permission;
2. exact active ad account + currency;
3. Pixel assignment to that account;
4. successful no-side-effect `validate_only` preflight;
5. explicit approval descriptor/hash for a `CREATE_PAUSED` plan;
6. one bounded provider mutation with no activation;
7. settled provider read-back with no issues/delivery failures;
8. immutable audit evidence;
9. zero spend/zero activation.

Until that sequence succeeds, lifecycle remains unchanged.

## Merge gate

This hardening may merge because it strengthens fail-closed provider validation without enabling activation or spend. Merge requires a green canonical Quality Gate on the exact current head and a fixed-head merge. The external billing blocker remains open after merge and must not be represented as provider-write validation success.

After this clean replacement merges, legacy PR #78 may be closed as superseded.
