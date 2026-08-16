# Provider Write Validation Register — Foundation v1 Closeout

Status: **FROZEN PRIORITY / NO NEW BREADTH**

This register distinguishes implementation, immutable historical provider evidence and current provider validation. A capability is not promoted merely because code exists, a contract test is green or an older provider smoke succeeded.

## Priority order

### 1. Instagram publication — real write evidence + current provider binding

Current evidence:

- PR #37 is merged and delivered the explicit one-shot execution gate for the first real Instagram publication;
- the publication path required the exact approved request SHA-256 and verified a `PUBLISHED` result rather than enabling generic publication writes;
- PR #37 head `8297c5f99b62e59e16b5b37317c4c0f529c0405c` passed Quality run `31663466024` before merge;
- the publication actually occurred at the provider; the subsequent failure mode was stale local state, not absence of the external side effect;
- PR #64 is merged at `203e6e1a5c3d57d9e14dcc36c69283b803a8f39e` and adds provider-backed media reconciliation (`id`, caption, media type, permalink, timestamp), strict single-match recovery and fail-closed handling before any retry;
- M-FOUND-12 exact branch provider READ run `31912813129` is green and freshly verifies scopes, Facebook Page `306103746115875`, Instagram account `17841402033495654`, username `tocadomorcego` and recent media through the production runtime identity;
- M-FOUND-12 PR provider READ run `31912815007` is green; sanitized artifact `9254146159` has digest `sha256:db586128234fb42b1cffd4ecf43b582ba5b2d28fb649524f26649eaf2acfc595`;
- the TOCA-managed daemon/scheduler and command-driven approved publication path are already merged;
- generic publication writes remain disabled outside an exact approved request/job.

Foundation conclusion:

**Real provider write + provider-backed reconciliation are proven. Current account/provider binding is freshly revalidated. M-FOUND-12 deliberately does not create a duplicate Instagram publication merely to refresh the write timestamp.**

Any future publication still requires exact descriptor/approval/idempotency, no blind retry after ambiguous outcome, provider read-back/resource identity and immediate write disable outside the approved execution.

### 2. Instagram Direct / reply

Current evidence:

- merged history contains a controlled real Direct response with exact Page/Instagram binding, granted messaging permission/task, idempotency reservation and provider acknowledgement.

Foundation v1 validation requirement before broader daily use:

- current exact-head account/scopes READ;
- approved deterministic recipient/conversation binding;
- one controlled reply only to an explicitly selected safe test conversation when a real operational need exists;
- provider ACK/read-back bound to the exact external resource/message;
- immutable audit evidence;
- no generic engagement-write flag promotion.

Lifecycle conclusion: **historically provider-backed; not promoted to generic daily outbound by Foundation closeout**.

### 3. Meta Ads `meta_ads.campaign.create_paused`

Current evidence:

- the primary Meta Ads account is now `311793958882290`; `394512749760530` is superseded as an operational target and remains relevant only to historical provider evidence;
- canonical account/Pixel relationship was identified during provider diagnostics;
- provider validate-only operations reached final Ad validation and exposed provider readiness/billing gates without creating an active campaign;
- PR #118 ports settled-state/read-back hardening, `WITH_ISSUES`/delivery-check fail-closed behavior and final Ad `validate_only` preflight onto the current controlled-write path;
- the replacement provider-smoke workflow is manual PREPARE/EXECUTE, exact plan/hash bound, PAUSED-only and zero-retry; it no longer writes on `push`.

Production validation evidence:

1. primary-account PREPARE passed provider `validate_only`;
2. exact approved request SHA-256 `47d719b08c31ca8db827e8d9c89c3f8374cf915ee22653ad270cdc0096c8d243`;
3. one bounded CREATE_PAUSED mutation in run `31920903042`, zero retries and no activation;
4. the initial settlement poll timed out, so the mutation was not retried;
5. GET-only reconciliation run `31921580945` recovered exact campaign / Ad Set / creative / Ad IDs `52618007729865` / `52618007731065` / `2844574235935509` / `52618007737265`;
6. campaign, Ad Set and Ad settled configured/effective `PAUSED`, with no issues or failed delivery checks;
7. duplicate counts are one and provider spend is `0`;
8. sanitized artifact `9256521917`, digest `sha256:f70b4cd4a272588e1f5480eb8fd3a2f0172ecd5c643f1aede24fa25058422cf5`.

Lifecycle conclusion: **PRODUCTION_VALIDATED for controlled CREATE_PAUSED on account `311793958882290`; activation, budget expansion and spend remain unvalidated and prohibited**.

Final closeout supplement — 2026-08-16:

- internal settlement timeout root cause fixed by PR #160; no current Meta/admin blocker remains;
- READ `31938462172` passed; artifact `9261342231`;
- PREPARE `31938638085` passed; artifact `9261422433`;
- exact CREATE_PAUSED `31938973330` passed; artifact `9261553921`;
- exact campaign / Ad Set / Ad: `52618058314265` / `52618058315465` / `52618058325265`;
- independent GET-only READBACK `31939348180` passed; artifact `9261583620`;
- campaign, Ad Set and Ad are all configured/effective `PAUSED`;
- no created object has effective `ACTIVE` status;
- exact campaign Insights returned no delivery row; normalized real spend is `BRL 0.00`;
- ACTIVATE was not executed; public MCP Meta Ads writes remained disabled.

Operational domain closeout: **META ADS = PRODUCTION_VERIFIED** for controlled PAUSED-only creation. Provider validation classification: **controlled CREATE_PAUSED is PRODUCTION_VALIDATED**. Runtime registry status remains **`IMPLEMENTED` by design** while public Meta Ads writes stay disabled; the Architecture Gate enforces this controlled-write boundary.

### 4. Google Ads

Current evidence:

- PR #112 implements phased capability/contracts and deterministic tests;
- no accepted current live credential/scope/customer READ proof is recorded for Foundation v1.

Required sequence:

`READ_ONLY -> PREPARE -> CREATE_PAUSED -> READBACK`, with real credential/scopes/customer binding before any provider write.

`ACTIVATE`, budget changes and spend are not permitted as shortcuts to validation.

Lifecycle conclusion: **do not promote; live READ prerequisite missing**.

### 5. Privacy-governed WhatsApp / Email outbound

Current evidence revalidated on 2026-08-16 against `main@81f6f84df6b725bfc5994c2d1582241b7936c614`:

- Privacy/R16 PR #115 is merged and canonical;
- Omnichannel PR #104 is merged and reconciled against canonical Privacy + CRM Core;
- all 18 Omnichannel capabilities remain `SPECIFIED`, `runtimeExposed=false` and `productionExecutionAllowed=false`;
- Omnichannel imports canonical `PrivacyScope` / `SuppressionDecision` and does not recreate consent, preferences, suppression or `ContactRecord`;
- canonical R16 `privacy.suppression.check` fails closed for unknown legal basis, unknown consent, unknown required preference and suppression;
- Omnichannel refuses outbound for `AMBIGUOUS`/unresolved contact identity, `UNKNOWN_BLOCKED`, `SUPPRESSED`, policy denial or inactive approval;
- WhatsApp/Email sends require approval + `idempotency_key`, while the external provider boundary remains non-idempotent and forbids blind resend after uncertain outcome;
- Nurture reuses the existing TOCA Core durable workflow engine/timers and creates no parallel scheduler;
- no real WhatsApp or Email provider implementation/binding, approved sender/number/domain, webhook path or provider-backed read-back exists in the repository/runtime configuration;
- `.env.example` contains no Omnichannel provider variables;
- GitHub Actions secret/variable metadata is inaccessible to the current integration and therefore cannot be used as readiness evidence; in any case there is no Omnichannel runtime adapter to consume such a secret.

Operational classification:

- **CONTRACT_READY:** YES for WhatsApp, Email and Nurture;
- **PROVIDER_READY:** NO for WhatsApp and Email;
- **REAL_SEND_VALIDATED:** NO;
- **READBACK_VALIDATED:** NO;
- **BLOCKERS:** `BLOCKED_EXTERNAL_PROVIDER`.

No provider fake and no test send were created merely to claim production readiness. Detailed credential, sender/domain/number, webhook, verification, DNS, template approval, safe-test-destination and read-back gates are recorded in `docs/operations/omnichannel-operational-closeout.md`.

Required sequence after a real provider is selected and bound:

`READ/VERIFY -> PREPARE -> CONTROLLED SAFE TEST SEND -> PROVIDER READBACK`.

Unknown contact, ambiguous identity, unknown legal basis/consent/preference or suppression must fail before the provider call. A real audience/campaign send is prohibited during validation.

Lifecycle conclusion: **contracts ready; production outbound remains `BLOCKED_EXTERNAL_PROVIDER`; do not promote lifecycle until real provider binding plus controlled send/read-back evidence exists**.

## Provider-write rules for Foundation v1

- No blind retry after a timeout or ambiguous external response.
- No terminal write success without provider read-back/resource identity or provider-backed reconciliation evidence.
- No production write based only on a fake provider or contract test.
- No financial activation simply to prove the path works.
- No duplicate business output solely to make validation evidence newer.
- No global write flag when an exact approved per-request/per-job gate is sufficient.
- No provider credential values in repository evidence.
- Every write candidate must already have a stable canonical capability/domain boundary; Foundation v1 will not add new provider families to increase coverage.

## Stop-breadth rule

Until M-FOUND-12, repository governance, reliability/DR, priority provider-write validations and Privacy are closed, new product/provider families are deferred unless they fix a P0/P1 production defect or are required to complete an existing Foundation contract.
