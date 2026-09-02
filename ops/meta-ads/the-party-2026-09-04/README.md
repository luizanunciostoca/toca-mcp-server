# The Party — 2026-09-04 — Meta Ads execution assets

Status: `APPROVAL_BOUND / CREATE_PAUSED_ONLY`

This directory is intentionally hydrated at workflow runtime from the canonical TOCA OS private Drive folder. Binary creative files are not committed to Git.

## Fixed campaign envelope

- Meta ad account: `311793958882290`
- Currency: `BRL`
- Objective: `OUTCOME_SALES`
- Optimization: `OFFSITE_CONVERSIONS`
- Conversion event: `PURCHASE`
- Pixel: `461233076843065`
- Total lifetime budget: `R$ 300.00` (`30000` minor units)
- Audience: broad `21–45`
- Geography: Morro de São Paulo center `-13.3833,-38.9167`, radius `2 km`
- Publisher platforms: Facebook + Instagram
- Campaign/ad set/ads are created only as `PAUSED`
- This executor contains no activation path.

## Canonical private Drive source

Folder: `META_ADS_THE_PARTY_2026-09-04`

| Slot | Drive file id | Runtime file | SHA-256 |
| --- | --- | --- | --- |
| Hero | `1iL2v_mBCsLPgFxl5gi23DavqNqet3OUZ` | `creative-01-hero.jpg` | `f3f6cbefacea0367ce70f38c0d08fde01a00386dd87e5212ac80d9e31c1fb9af` |
| Experience | `1_4RFeZ9FvkP93-huB_rBG3JeuPpPEtDq` | `creative-02-experience.jpg` | `d64e32bdf41f7eea918442256dfe36bc7c84c13ffcd64a8c630e4db0a8b60ce5` |
| Urgency | `1IsQA4Hnl4uC1GNTK6jaiNC0IvjHugDj6` | `creative-03-urgency.jpg` | `f966cd2e5a25a41ee69219b47c2c9b6dcbc6494a693bb7cb4c1320ac964406e2` |
| Venue + crowd | `1aXdTAZXpkW9DeW9dI0V7uu7GUNOuwoPz` | `creative-04-venue-crowd.jpg` | `651ff66c4cca870304a7097fe7cb160f3e2b1b5bdbec8b14ffda97cb9178f331` |
| Brand statement | `17gyfiyA4hAwmP1R_8kqxYHs3DcYTOGzq` | `creative-05-brand-statement.jpg` | `a4fafe3b833138351ac60d42f8ef616812c664a25620a7b7a9fba888739ee4e8` |

The workflow downloads each file through the existing Workload Identity / Drive readonly boundary, verifies JPEG magic, minimum size and exact SHA-256 before the quality gate and before any Meta provider write.

## Execution gate

Implementation must be merged first. A second, isolated main-branch change containing only:

`control/meta-ads-the-party-2026-09-04.create-paused`

with exact content:

`APPROVED_THE_PARTY_2026_09_04_R300_CREATE_PAUSED`

is the execution approval marker. The workflow additionally performs live account, permission, duplicate-campaign and 2 km delivery-estimate preflight before creating anything.
