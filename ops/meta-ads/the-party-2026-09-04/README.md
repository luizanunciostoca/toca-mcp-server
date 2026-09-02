# The Party — 2026-09-04 — Meta Ads staging package

Status: **AWAITING_CREATIVES**

This package freezes the non-creative campaign decisions for the Friday, 2026-09-04 The Party paid-media flight.

## Fixed campaign envelope

- account: `311793958882290`
- currency: BRL
- total approved planning budget: R$ 250,00
- intended budget mode: lifetime / hard total
- objective: `OUTCOME_SALES`
- optimization: `OFFSITE_CONVERSIONS`
- conversion event: `PURCHASE`
- pixel: `461233076843065`
- page: `306103746115875`
- Instagram actor: `17841402033495654`
- destination: `https://tocadomorcego.com.br/produtos/the-party-3819.html`
- audience: broad 21–45
- Advantage Audience expansion: disabled
- custom location center: `-13.3833,-38.9167`
- radius: 2 km
- platforms: Facebook + Instagram
- preferred placements: Feed, Stories, Reels
- excluded: Audience Network, Messenger
- initial schedule: 2026-09-02 14:33 BRT through 2026-09-05 01:00 BRT

## Safety / provider-write rule

No Meta provider write is allowed while any creative slot is missing.

When the creatives arrive:

1. save the approved source files;
2. calculate and record SHA-256 for each asset;
3. fill `creative-manifest.template.json` and promote it to the final creative manifest;
4. assemble the deterministic campaign plan;
5. execute fresh Meta READ preflight (`accounts`, recent `insights`, and Morro audience diagnostic);
6. fail closed if the 2 km custom-location envelope is rejected;
7. execute the governed prepare step and capture the approval SHA;
8. create campaign/ad set/creatives/ads in `PAUSED` state only;
9. provider-readback all created entities;
10. activation remains a separate explicit financial/external-write approval.

## Creative slots

- `hero_event`
- `experience_video_or_motion`
- `urgency_friday`

All three are intentionally missing. No other campaign decision should need to be supplied by the user when the assets arrive unless the provider preflight rejects the frozen targeting envelope or fresh performance evidence requires an objective change.

## Important budget note

The current generic `meta_ads.campaign.create_paused` MCP contract uses a daily budget field. This event package therefore records R$ 250,00 as a lifetime/hard-total requirement and MUST NOT silently translate it into an unconstrained daily budget. Use the existing exact-event/lifetime-budget execution pattern (as previously used for The Party 2026-08-15) or extend the governed generic contract before provider creation. Do not widen spend authority.
