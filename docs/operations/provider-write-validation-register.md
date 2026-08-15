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

- the current validated ad-account target is `394512749760530`; old diagnostics/workflows that referenced `311793958882290` are superseded and must not be used;
- canonical account/Pixel relationship was identified during provider diagnostics;
- provider validate-only operations reached final Ad validation and exposed provider readiness/billing gates without creating an active campaign;
- PR #118 ports settled-state/read-back hardening, `WITH_ISSUES`/delivery-check fail-closed behavior and final Ad `validate_only` preflight onto the current controlled-write path;
- the replacement provider-smoke workflow is manual PREPARE/EXECUTE, exact plan/hash bound, PAUSED-only and zero-retry; it no longer writes on `push`.

Required sequence:

1. reconcile #118 to the then-current `main` and pass exact-head Quality;
2. granted `ads_management` proof;
3. exact active ad account `394512749760530` + currency proof;
4. exact Pixel assignment proof;
5. provider `validate_only` preflight returns no created Ad ID;
6. explicit approved `CREATE_PAUSED` descriptor/hash;
7. one bounded create-paused mutation;
8. provider states settle safely as paused with no `issues_info` or failed delivery checks;
9. immutable evidence/read-back;
10. zero activation and zero spend.

Lifecycle conclusion: **IMPLEMENTED / fresh CREATE_PAUSED provider settlement validation pending; do not activate or spend**.

### 4. Google Ads

Current evidence:

- PR #112 implements phased capability/contracts and deterministic tests;
- no accepted current live credential/scope/customer READ proof is recorded for Foundation v1.

Required sequence:

`READ_ONLY -> PREPARE -> CREATE_PAUSED -> READBACK`, with real credential/scopes/customer binding before any provider write.

`ACTIVATE`, budget changes and spend are not permitted as shortcuts to validation.

Lifecycle conclusion: **do not promote; live READ prerequisite missing**.

### 5. Privacy-governed WhatsApp / Email outbound

Current evidence:

- Privacy PR #115 has been rebuilt directly on merged M-FOUND-11 `main@18c36ba428d1b10981b5ea68a23b561daa07bd96`;
- Privacy exact-head `d949a7b874d88791e86fe2613ecd9a74feb8db1c` passed full Quality run `31912655861`;
- Omnichannel PR #104 remains downstream and must stay blocked until Privacy is actually merged and post-merge `main` is green.

Required sequence:

1. merge Privacy #115 by exact green head after any necessary final-main reconciliation;
2. verify post-merge `main` Quality;
3. reconcile #104 against the merged canonical privacy ledger/decision contracts;
4. prove one unambiguous CRM `ContactRecord` resolution;
5. prove purpose + channel policy + consent/preference where required;
6. prove `privacy.suppression.check` explicitly permits the use;
7. prove provider credential/account/template/sender binding;
8. exact approval/idempotency where required;
9. one bounded safe test write only after the above gates;
10. delivery/provider read-back and immutable audit evidence.

Unknown contact, unknown legal basis/consent/preference or suppression must fail before the provider call.

Lifecycle conclusion: **blocked by Privacy merge and provider connectivity validation**.

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
