# R28 Google Ads Paid Media execution contract

## Scope

Google Ads extends the existing R28 paid-media governance model. It does not create R33 and does
not introduce a parallel approval, audit or policy subsystem.

After reconciliation with the current main branch, the canonical catalog contains 758 capabilities:
the existing 745 entries plus these 13 Google Ads capabilities, all attached to R28.

Implemented capability family:

- `google_ads.account.inspect`
- `google_ads.campaigns.list`
- `google_ads.insights.get`
- `google_ads.conversion_actions.list`
- `google_ads.campaign.prepare`
- `google_ads.campaign.create_paused`
- `google_ads.campaign.readback`
- `google_ads.campaign.activate`
- `google_ads.campaign.pause`
- `google_ads.campaign.update_budget`
- `google_ads.targeting.validate`
- `google_ads.spend.monitor`
- `google_ads.conversions.monitor`

## Mandatory rollout order

`OFF -> READ_ONLY -> PREPARE -> CREATE_PAUSED -> READBACK -> MANAGE`

Each phase includes only capabilities from that phase and the phases before it. `MANAGE` is the
first phase that can register activate, pause and budget-update tools.

The phase flag is not an authorization mechanism. All write definitions remain `IMPLEMENTED`, not
`PRODUCTION_VALIDATED`, so core policy denies provider side effects until R22 lifecycle promotion
has real provider evidence.

## Provider contract

The adapter uses Google Ads API v25 through REST. Runtime access requires an OAuth access-token
reference, developer-token reference and the `https://www.googleapis.com/auth/adwords` scope at the
provider. Manager-account access can additionally send `login-customer-id`.

Secrets are references resolved at execution time; token values are not stored in catalog metadata
or tool definitions.

`google_ads.targeting.validate` submits the same grouped mutation shape used by creation with
`validateOnly: true`, `partialFailure: false`, and therefore performs validation without a committed
provider mutation.

`google_ads.campaign.create_paused` uses one grouped `googleAds:mutate` request with temporary
resource names to create the budget, campaign and targeting atomically. Campaign status is forced
to `PAUSED`. Provider completion is accepted only after a real campaign resource name is returned
and read-back confirms `PAUSED`.

## Guardrails

Any enabled phase requires:

- configured target customer and exact customer allowlist match;
- configured currency;
- maximum daily budget in micros;
- currency minor-unit conversion in micros for R27 financial ceilings;
- allowed location criterion IDs;
- OAuth access-token secret reference;
- developer-token secret reference.

Optional language criterion IDs form an additional allowlist. This implementation supports SEARCH
campaign creation only; other channel types fail closed.

From `CREATE_PAUSED` onward, `DATABASE_URL` is mandatory so write execution can use the persistent
Audit Ledger and ApprovalStore.

## Write governance

Provider writes use the existing execution pipeline:

1. authenticated requester identity;
2. target-account binding;
3. deterministic descriptor SHA-256;
4. R27 approval scope binding;
5. financial amount/currency binding where spend can be affected;
6. atomic approval reservation;
7. provider mutation;
8. provider read-back against expected state;
9. approval consumption only after successful read-back;
10. append-only execution audit evidence.

Activation first reads the campaign budget, checks the configured maximum and binds the current
budget amount to the ApprovalRecord financial ceiling. Budget updates bind the requested amount in
the same way.

No write may be promoted to production solely because code, unit tests or CI are green. Promotion
requires credentials, correct provider permissions/scopes, the real intended account, successful
provider validation, R27 approval behavior and provider read-back evidence.

## Zero-spend test policy

Automated tests use fake adapters and in-memory secrets. They do not call the Google Ads network,
do not create real campaigns and do not activate delivery. Validation tests assert
`validateOnly: true`; creation-shape tests assert `PAUSED` status only.
