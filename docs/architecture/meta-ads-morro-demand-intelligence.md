# Meta Ads — Morro Demand Intelligence

Status: IMPLEMENTED (runtime-bound, provider validation pending)

## Purpose

Use Meta Marketing API audience delivery estimates as one aggregate demand signal for paid-media planning in Morro de São Paulo. The signal is explicitly an audience estimate/proxy and MUST NOT be described as an exact count of devices or people physically present in Morro.

The provider fields used by this implementation are MAU estimate bounds. They are not treated as a real-time footfall sensor. For that reason, Meta audience level and trend signals account for only 20% of the final demand index; campaign performance, calendar/event context, seasonality and operational capacity remain the dominant inputs.

## Canonical geography

The implementation reuses the Meta Ads geography already used by TOCA OS campaign planning:

- latitude: `-13.3833`
- longitude: `-38.9167`
- radius: `15 km`
- geo key: `morro-de-sao-paulo-15km`

The canonical targeting spec is owned by `src/providers/meta-ads/meta-ads-demand-intelligence.ts`.

## Provider source

`MetaAdsReadProvider.getDeliveryEstimate()` calls the Meta Marketing API ad-account `delivery_estimate` edge with:

- `targeting_spec`;
- `optimization_goal` (default `REACH` at the demand-intelligence layer);
- fields `estimate_mau_lower_bound`, `estimate_mau_upper_bound`, `estimate_ready`.

The system stores and exposes lower/upper bounds and their midpoint. No device identifiers, user identifiers, precise live-location records, or individual-level data are requested or persisted.

## Durable history

Migration `022_meta_ads_geo_demand_intelligence.sql` creates `meta_ads_geo_audience_samples`.

For each ready estimate, the runtime records:

- tenant;
- ad account;
- canonical geo key;
- lower/upper estimate bounds;
- midpoint;
- estimate readiness;
- optimization goal;
- targeting spec;
- observation timestamp.

Automatic observations are bucketed to the UTC hour. Multiple demand capabilities executed in the same hourly planning cycle therefore reuse the same durable observation key instead of generating near-duplicate samples. An explicit `observedAt` remains available for deterministic tests and controlled backfills.

`PostgresMetaAdsGeoAudienceStore` provides idempotent append semantics for the same `(tenant, account, geo, observed_at)` tuple and chronological readback.

## Morro Demand Index

The index is deterministic and bounded from `0` to `100`.

Weights:

| Signal                                    | Weight |
| ----------------------------------------- | -----: |
| Audience level vs. 7-day median           |    10% |
| Audience-estimate trend vs. ~24h baseline |     5% |
| Audience-estimate trend vs. ~7d baseline  |     5% |
| Paid-media performance score              |    35% |
| Calendar/event score                      |    20% |
| Seasonality score                         |    15% |
| Operational capacity score                |    10% |

Missing contextual scores are neutral (`50`). Until enough audience history exists, missing audience baselines are also neutral. Signal confidence starts at `0.4` for a ready provider estimate and increases as history, 24h baseline, and 7d baseline become available.

The 24h/7d values represent changes in Meta's modeled audience estimate, not measured changes in physical footfall.

Bands:

- `LOW`: 0–29
- `GUARDED`: 30–44
- `NORMAL`: 45–59
- `HIGH`: 60–89
- `PEAK`: 90–100

## Budget recommendation

`meta_ads.budget.recommend` is a READ capability. It never performs a provider write.

Base recommendation by index:

| Demand Index | Suggested daily-budget change |
| ------------ | ----------------------------: |
| < 30         |                          -20% |
| 30–44        |                          -10% |
| 45–59        |                            0% |
| 60–74        |                          +10% |
| 75–89        |                          +15% |
| 90–100       |                          +20% |

Safety controls:

1. recommended change is hard-capped to `±20%`;
2. if performance score is below `40`, a positive scale recommendation becomes HOLD;
3. if capacity score is below `20`, a positive scale recommendation becomes HOLD;
4. when signal confidence is below `0.60`, recommendation magnitude is capped to `±10%`;
5. the existing `BudgetGuardrailPolicy` remains the financial authority;
6. if no runtime budget policy is configured, the result is `REQUIRE_APPROVAL`;
7. the recommendation output always carries `writeExecuted: false`.

A later financial write MUST use the existing governed Meta Ads write path, its approval boundary and provider readback. This engine must not bypass those controls.

## Runtime capabilities

The implementation binds these existing canonical R08 capability IDs to the TOCA Core runtime:

### `meta_ads.audience.inspect`

Reads the Meta audience estimate for canonical Morro targeting, records a ready hourly observation when PostgreSQL is available, and returns current bounds, midpoint, history count, 24h/7d estimate trends and confidence.

### `meta_ads.opportunity.detect`

Calculates the Morro Demand Index using the audience signal plus optional performance, calendar/event, seasonality and capacity scores.

### `meta_ads.budget.recommend`

Calculates a guarded daily-budget recommendation from the demand index and current budget. It also returns the full demand-index evidence and does not modify campaigns or budgets.

All three are READ-only and require Meta `ads_read` access.

## Planner integration

A paid-media planning cycle should:

1. collect campaign performance context from Meta Insights;
2. resolve calendar/event, seasonality and operational-capacity context;
3. execute `meta_ads.audience.inspect` when an explicit audience diagnostic is needed;
4. execute `meta_ads.opportunity.detect` when an index-only diagnostic is needed; or
5. execute `meta_ads.budget.recommend` directly when a guarded budget recommendation is needed, because its output already contains the full demand index and audience evidence;
6. include the resulting recommendation/evidence in the campaign plan;
7. route any actual financial change through the existing approval/guardrail/write/readback workflow.

A high Meta audience estimate alone is never sufficient to scale spend. Weak campaign performance or low operational capacity prevents positive scaling.

## Production-validation gate

`IMPLEMENTED` does not mean the Meta delivery estimate has been production-validated for the live account. Promotion beyond IMPLEMENTED requires:

- migration applied to the target database;
- live `delivery_estimate` READ against the approved Meta ad account;
- evidence that the canonical 15 km Morro targeting is accepted by the provider;
- durable sample readback;
- verification that no provider write is emitted by the three demand capabilities;
- accumulation of historical samples before trend-based decisions are treated as high-confidence;
- Quality Gate passing on the implementation commit.
