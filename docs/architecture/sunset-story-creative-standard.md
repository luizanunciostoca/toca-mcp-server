# Sunset Story creative standard

Status: active canonical integration contract.

## Purpose

Define how `luizidebook/toca-mcp-server` and the TOCA Marketing Autopilot consume the canonical Sunset Story visual standard without moving creative business truth out of TOCA OS.

The authoritative visual standard is the Google Drive document `TOCA_OS — STORY_CREATIVE_STANDARD_SUNSET_v1.0` (`1gTFxCLWnsZIy2vRKHGglXILMAexXoIUzd5WDZvpOtsM`). The canonical reference set is the Drive folder `01_SUNSET_PADRAO_v1.0` (`1kNN7WDKbdP_iJ7bBOztY3A1d2fBkapWY`).

The repository mirror at `control/creative-standards/sunset-story-standard.v1.json` exists to make the contract deterministic and auditable for code, tests and operators. It must not silently diverge from the Drive source of truth.

## Scope

This standard applies only when all of the following are true:

- `operation=SUNSET`;
- `channel=INSTAGRAM`;
- `format=STORIES`.

The standard identity is `SUNSET_STORY_V1`, version `1.3`, with reference set `SUNSET_STORY_REFERENCE_SET_20260817`. The active layout catalog is `control/creative-standards/sunset-story-reference-template-library.v1.json` (`SUNSET_REFERENCE_TEMPLATE_LIBRARY` v1.0), mirrored from the canonical Drive library `1gKsm3TGHlbqmC091TCbj7xXTzHfEgTHe` and described in `docs/architecture/sunset-story-reference-template-catalog.md`.

## Production contract

The production path is:

`CONTENT_ITEM` → resolve `SUNSET_STORY_V1` → resolve an explicit reference template from the library → analyze the photograph's safe/protected regions → select a `MARKETING_READY` master → render the pure template deterministically → insert copy, CTA and official logo assets → Template Gate → Brand Gate → Venue Gate → Sunset Quality Gate → persist `STORY_CREATIVES` → `STORY_READY` → Review/Approval → Prepare → Publish.

`STORY_READY` means the final creative bytes already exist and passed the required creative gates. `PREPARE` and `PUBLISH` must consume that final Story asset and must never rebuild the graphic composition.

## Approved template classes

- `SUNSET_HERO_LIFESTYLE`
- `SUNSET_VIEW_SCENERY`
- `SUNSET_SOCIAL_EXPERIENCE`
- `SUNSET_DRINKS_EXPERIENCE`
- `SUNSET_INFO_HOURS`

The Marketing Autopilot should vary the explicit reference template and source asset according to the canonical anti-repeat policy. A template is a complete composition contract, not a loose style hint. The goal is a stable visual grammar without repeated identical layouts or hybrid combinations of unrelated templates.

## Visual invariants

The final canvas is 1080×1920 / 9:16. The visual hierarchy is photography first, then headline, supporting copy, CTA and brand footer. Sunset photography should prioritize real approved assets with people, golden hour, social interaction, sea/view, Toca architecture/luminaires, drinks and lifestyle details.

The standard uses Bodoni/Didot-class editorial serif candidates for aspirational headlines and Montserrat/Avenir-class geometric sans candidates for supporting information, time and CTA. White is the default text/logo color, sunset orange and soft gold are supporting accents, and black is mandatory when the analyzed text region is light. Contrast is evaluated on the selected safe region, not on the whole image.

The brand footer uses official Drive assets in the canonical order Toca do Morcego → Corona → Red Bull → Morro Digital. AI reconstruction of logos is prohibited.

## Source and lineage boundary

A generated or synthetic photograph must not replace an available real official asset. The final Story creative must retain lineage from `story_creative_id` to `master_asset_id` and `source_asset_id`.

The ten images supplied and approved by the user are stored under `01_REFERENCIAS_ORIGINAIS`; derived guide/example files are stored separately under `02_EXEMPLOS_DERIVADOS`. Derived examples are visual references only and do not override official Brand Kit assets, factual content, policy or approval requirements.

## Required write-back

For Sunset Stories, `STORY_CREATIVES` must preserve at least:

- `creative_standard_id=SUNSET_STORY_V1`;
- `creative_standard_version=1.3`;
- `template_class`;
- `reference_set_id=SUNSET_STORY_REFERENCE_SET_20260817`;
- `source_asset_id`;
- `master_asset_id`;
- `master_drive_file_id`;
- `story_creative_id`;
- `creative_version`;
- `headline`;
- `support_copy`;
- `cta_text`;
- `brand_gate_status`;
- `quality_gate_status`;
- `lineage_verified`.

If the standard or explicit reference template cannot be resolved, required official brand assets are unavailable, lineage is incomplete, safe/protected-region analysis is missing, a required template element is absent, template purity/reference similarity fails, or any required Template/Brand/Venue/Quality Gate fails, the worker must fail closed and must not mark the item `STORY_READY`.

## Publication boundary

This standard does not change Approval, Policy, capability or provider gates. A creative being visually compliant does not authorize external publication. The renderer is a pure-template engine: it may render only the explicit descriptor and plan supplied by the library, and it must not fall back to a generic layout for a Sunset reference template.

The publication layer receives an immutable final asset. It must verify the approved descriptor/hash and existing execution gates exactly as before. No publication command is created by adding or changing this standard.
