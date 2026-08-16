# Meta Ads Final Controlled Provider Validation — 2026-08-16

Status: **PRODUCTION_VALIDATED — CONTROLLED CREATE_PAUSED ONLY**

This document records the final clean provider-backed validation of `meta_ads.campaign.create_paused` on the canonical Meta Ads account without widening the public MCP surface, enabling generic writes, activating any validation asset, or introducing blind retries.

## Scope and immutable guardrails

- primary Meta Ads account: `311793958882290` (`act_311793958882290`);
- currency: `BRL`;
- Pixel: `461233076843065` (`Pixel Toca do Morcego`);
- Facebook Page: `306103746115875`;
- Instagram actor: `17841402033495654`;
- provider API: Meta Marketing API `v24.0`;
- allowed validation mutation: one exact approved `CREATE_PAUSED` only;
- activation, budget expansion, automatic retry and validation-driven spend remain outside the validated boundary;
- public MCP Meta Ads writes remained disabled before and after the controlled execution.

## 1. Fresh provider READ

GET-only provider verification run `31938170694` completed successfully.

Evidence artifact:

- artifact ID: `9261257474`;
- artifact digest: `sha256:4d638e13acb038feefd5139293b145187704ff2a66635bccb9b96627e5f05513`;
- source SHA recorded inside the evidence: `ac0ba469a57f12c801148b5821e14e34fd86d281`;
- provider verification timestamp: `2026-08-16T09:07:21.445Z`.

The provider read proved:

- account `act_311793958882290` exists and is active (`account_status=1`);
- account currency is `BRL`;
- Pixel `461233076843065` is available;
- granted scopes include `ads_read`, `ads_management` and `business_management`;
- the read completed with `verified=true`.

Subsequent repository movement before the final PREPARE/EXECUTE consisted only of operational/documentation changes; no Meta Ads implementation or provider-binding code changed.

## 2. Exact PREPARE on the final Meta code state

Official PREPARE run `31938638085` executed from `main@90d23d83ed53b1c9e8f73c14409d1329b1826f14` and completed successfully.

Evidence artifact:

- artifact ID: `9261422433`;
- artifact name: `meta-ads-provider-prepare-prepare-31938638085-1`;
- artifact digest: `sha256:ef4d871ac1f3f766914cc2718cf84ca9775087f5cf828cdcb09bf07b88278755`.

The PREPARE phase passed Quality, account/Pixel/provider preflight and exact plan generation. All EXECUTE steps were skipped in this run by design.

Prepared smoke ID:

`prepare-31938638085-1`

Exact approved request SHA-256:

`ca9c42b911126cda121fcc41b12e4b4a571de5796b75e97cbf450002284b0bbf`

## 3. Safe cancellation before mutation

An initial EXECUTE run `31938818981` was cancelled during immutable image build by a temporary operational cancel workflow that mistakenly targeted the EXECUTE run while labeling it as a duplicate PREPARE.

The cancellation was safe and unambiguous:

- Quality and pre-mutation safety gates had passed;
- image build ended `cancelled`;
- `Deploy exact approved EXECUTE job` was skipped;
- `Execute one exact approved PAUSED mutation and verify provider settlement` was skipped;
- no Meta provider mutation occurred.

The erroneous temporary cancel workflow was removed before the retry. Because the first EXECUTE never reached the provider mutation step, retrying the exact same approved descriptor did not create duplicate-provider risk.

## 4. Final exact EXECUTE and provider readback

Dispatcher run `31938967660` re-dispatched the exact approved descriptor from PREPARE run `31938638085` with the same source SHA and request hash.

Final provider EXECUTE run:

- workflow run: `31938973330`;
- source/head SHA: `90d23d83ed53b1c9e8f73c14409d1329b1826f14`;
- conclusion: `success`;
- zero Cloud Run provider retries;
- exact approved request SHA-256: `ca9c42b911126cda121fcc41b12e4b4a571de5796b75e97cbf450002284b0bbf`.

The workflow completed all required gates successfully:

1. Quality;
2. exact phase/input validation;
3. Google Cloud authentication;
4. assertion that public MCP Meta Ads writes remain disabled;
5. immutable validation image build;
6. exact approved EXECUTE job deployment;
7. one controlled provider mutation;
8. provider settlement/readback;
9. evidence upload;
10. reassertion that public MCP Meta Ads writes remain disabled;
11. temporary validation-job cleanup.

Final provider resources:

- campaign `52618058314265` — configured `PAUSED`, effective `PAUSED`;
- Ad Set `52618058315465` — configured `PAUSED`, effective `PAUSED`;
- creative `2844574235935509`;
- Ad `52618058325265` — configured `PAUSED`, effective `PAUSED`.

No created validation resource was `ACTIVE` in provider readback.

Final sanitized EXECUTE artifact:

- artifact ID: `9261553921`;
- artifact name: `meta-ads-provider-execute-prepare-31938638085-1`;
- artifact digest: `sha256:d76ebbfa97a7742930fce3bf77b05cb255a97a893dc4d206b0bcb38ff1e3b0a7`.

The artifact records `requestSha256` and `approvedRequestSha256` as the same value:

`ca9c42b911126cda121fcc41b12e4b4a571de5796b75e97cbf450002284b0bbf`

This proves that the executed mutation was the exact plan approved by PREPARE rather than a regenerated or drifted request.

## 5. Repository movement during provider settlement

While the final provider settlement step was already executing, `main` advanced from `90d23d83ed53b1c9e8f73c14409d1329b1826f14` to `c3d2131690055e0a2636c44eadce2277aa5aba64`.

The exact compare showed one added file only:

`docs/operations/alerts-production-verification-2026-08-16.md`

No Meta Ads source, workflow, provider binding, account configuration or runtime behavior changed. The already-started provider mutation was therefore not cancelled or repeated: repeating a provider write solely to chase an unrelated documentation SHA would violate the no-duplicate/no-blind-retry rule.

## Final classification

`meta_ads.campaign.create_paused` remains **PRODUCTION_VALIDATED for controlled PAUSED-only creation on primary account `311793958882290`**.

The final 2026-08-16 validation additionally proves a clean single-run mutation and settled provider readback with campaign, Ad Set and Ad all `PAUSED`/`PAUSED`, exact PREPARE-to-EXECUTE hash binding, public writes still disabled and temporary execution infrastructure cleaned up.

This validation does **not** authorize or claim validation for:

- campaign/ad-set/ad activation;
- generic unattended Meta Ads writes;
- budget expansion beyond approved guardrails;
- automatic mutation retry after uncertain outcome;
- spend as a validation mechanism.

Future production writes must continue to require exact approval/descriptor binding, provider resource identity, fail-closed settlement checks and no blind retry after ambiguous external outcomes.
