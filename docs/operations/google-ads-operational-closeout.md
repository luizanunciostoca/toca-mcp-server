# R28 Google Ads operational closeout

Date: 2026-08-17

Status: **DEFERRED / NEXT_VERSION — CODE_COMPLETE REPOSITORY PATH, LIVE PROVIDER NOT V1 SCOPE**

## V1 release decision

Google Ads real-provider completion is explicitly outside TOCA OS V1. Its absence is **not a V1 release blocker** and must not be reported as an unresolved V1 gap.

The repository work already completed under R28 remains valid and must not be erased or downgraded to `PLANNED` merely because the live provider was deferred.

Canonical V1 classification:

| Scope | V1 evidence state | Executable live-provider claim | V1 disposition |
| --- | --- | --- | --- |
| Google Ads contracts, adapter, resolver and phase-gated runtime path in repository | `CODE_COMPLETE` | No production/provider claim | Preserved for next version |
| Real provider `READ_ONLY` | `PLANNED` as live-provider release scope | No | `DEFERRED / NEXT_VERSION` |
| Real provider `PREPARE` | `PLANNED` as live-provider release scope | No | `DEFERRED / NEXT_VERSION` |
| Real provider `CREATE_PAUSED` | `PLANNED` as live-provider release scope | No | `DEFERRED / NEXT_VERSION` |
| Real provider `READBACK` | `PLANNED` as live-provider release scope | No | `DEFERRED / NEXT_VERSION` |
| Real provider `MANAGE` / activation / budget changes | Not V1 validated | No | `DEFERRED / NEXT_VERSION` |

## Repository truth

The merged R28 work contains 13 `google_ads.*` capability definitions and a phase-gated resolver path. The public MCP surface is not widened merely by those definitions; runtime exposure still depends on Google Ads phase/configuration and TOCA Core governance.

The intended provider progression remains:

`OFF -> READ_ONLY -> PREPARE -> CREATE_PAUSED -> READBACK -> MANAGE`

No phase may be skipped. `CREATE_PAUSED` does not authorize activation.

## Last real production inspection retained as historical evidence

The 2026-08-16 operational inspection found no Google Ads environment/secret-reference binding on the production Cloud Run service. Specifically, there was no production binding for the required phase, customer identity, OAuth token reference, developer-token reference, allowed customer/currency/budget and targeting allowlists.

The inspection therefore stopped **before any Google Ads network mutation**:

- `google_ads.account.inspect`: not executed against the real provider;
- `google_ads.campaigns.list`: not executed against the real provider;
- `google_ads.insights.get`: not executed against the real provider;
- `google_ads.conversion_actions.list`: not executed against the real provider;
- `google_ads.campaign.create_paused`: not executed;
- `google_ads.campaign.activate`: not executed / not authorized;
- spend caused by that closeout: `0`.

This was a configuration/provider-readiness finding, not evidence that the in-repository implementation was absent.

## Next-version activation contract

When Google Ads is resumed in the next version, the live provider must be bound without committing secret values and validated in this order:

1. bind exact customer/login-customer identity, OAuth credential reference, developer-token reference and allowed account/currency/budget/targeting limits;
2. run real read-only account/campaign/insight/conversion checks and capture provider request evidence;
3. generate deterministic PREPARE output without mutation;
4. only after READ and PREPARE are correct, create one approved campaign in `PAUSED`;
5. independently read back the exact provider resource and prove `PAUSED` and zero unintended spend;
6. record approval, idempotency, audit and provider-readback evidence;
7. treat `MANAGE` as a separate higher-risk promotion; do not infer it from `CREATE_PAUSED` proof.

No mock, catalog entry, code binding or historical CI result may substitute for the real provider evidence above.

## CI truth

Historical green Quality runs remain evidence for the exact historical SHAs they validated. The current V1 governance closeout has:

`CI_VERIFIED = PENDING_FINAL_ACTIONS_ROUND`

That pending CI flag is independent of the Google Ads deferral and does not turn Google Ads into a V1 blocker.
