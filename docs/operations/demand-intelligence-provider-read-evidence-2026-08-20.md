# Demand Intelligence — Meta Ads provider READ evidence — 2026-08-20

Status: **PROVIDER_VERIFIED (READ boundary only)**

This evidence applies only to the Meta Marketing API READ boundary used by Demand Intelligence. It does not promote the full feature to `PRODUCTION_VERIFIED`, does not prove production migration rollout, and does not authorize any campaign mutation.

## Validation identity

- repository: `luizanunciostoca/toca-mcp-server`
- pull request: `#15`
- feature branch: `recovery/meta-ads-demand-intelligence-20260819`
- provider-validation head: `1276cc2252847f2167e014b88a2e6f91f5745f62`
- GitHub pull-request merge SHA used by the validation job: `cb0b47bbeb8f6756b070370adcdff658922dc02c`
- workflow run: `32333785052`
- sanitized artifact id: `9393934030`
- artifact digest: `sha256:69d32f5d8e3f672788fb3cac6cc64aaea066eebc3654dc73ebfcad7e1bfc1634`
- verified at: `2026-08-20T04:58:51.645Z`

The validator authenticated through the repository's existing Google Cloud Workload Identity Federation and executed under the canonical production runtime service identity with the existing Secret Manager token. No parallel credential path was introduced.

## Provider request

Provider: Meta Marketing API `v24.0`

Operation: **GET** `delivery_estimate`

Ad account: `311793958882290`

Required/granted scope checked by the validator: `ads_read`

Optimization goal: `REACH`

Canonical targeting:

- latitude: `-13.3833`
- longitude: `-38.9167`
- radius: `15 km`
- distance unit: `kilometer`

Requested fields:

- `estimate_mau_lower_bound`
- `estimate_mau_upper_bound`
- `estimate_ready`

## Sanitized provider result

- `estimate_ready=true`
- lower modeled MAU bound: `74300`
- upper modeled MAU bound: `87500`
- midpoint used only as a derived planning signal: `80900`
- `providerReadOnly=true`
- `writeExecuted=false`
- validation result: `verified=true`

These values are Meta's aggregate/modelled audience-delivery estimate for the requested targeting. They are **not** an exact count of people, devices or mobile phones physically present in Morro de São Paulo and must never be represented as live footfall.

## Safety result

The validation performed no campaign creation, activation, pause, budget change, publication, payment or other business-provider write. The temporary validator and its temporary Cloud Run job/image were cleanup-only validation infrastructure and are not part of the final repository tree.

The Demand Intelligence capabilities remain:

- `meta_ads.audience.inspect` — READ;
- `meta_ads.opportunity.detect` — READ;
- `meta_ads.budget.recommend` — READ;
- recommendation output contract: `writeExecuted=false`.

Any future financial mutation must continue through the existing governed Meta Ads write path, Approval/Policy gates and provider readback.
