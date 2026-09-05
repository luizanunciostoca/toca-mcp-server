# Video Intelligent Asset Selection V1

## Purpose

Turn external Google Drive footage folders into a searchable TOCA OS audiovisual source library without physically copying every video into `TOCA_OS`.

Physical storage remains Google Drive. Canonical discovery, eligibility and usage authority remain in `TOCA_OS — CREATIVE_TRUTH_REGISTRY_v1.0`.

## Source libraries

The current physical roots are registered in `VIDEO_LIBRARY_SOURCES`:

- `LIB-001` — Camera/Drone production footage — Drive folder `1G9x0tVOLyVKS-FSQRMe8oxkq2AfxgE7t`;
- `LIB-002` — Marketing media library — Drive folder `10BsHxsIVuLsNsTdt-UENHodcoIGQYhbL`.

`COPY_POLICY=LINK_ONLY_NO_PHYSICAL_COPY` is intentional. Agents work from exact Drive File IDs after selection.

## Promotion boundary

`VIDEO_LIBRARY_INDEX` and `VIDEO_SOURCE_INTAKE` make files discoverable for cataloguing. They do **not** make footage selectable for production.

The promotion path is:

`FILE_DISCOVERY → VIDEO_LIBRARY_INDEX → VIDEO_SOURCE_INTAKE → HASH → TECHNICAL_PROBE → VISUAL_CLASSIFICATION → RIGHTS/LIKENESS → VENUE/PRODUCT BINDING → SHOT_ID → VIDEO_SHOTS`.

The production selector reads only `VIDEO_SHOTS`. It never silently promotes intake rows and never scans a whole physical folder during a Reel request.

## Independent states

Three states must remain independent:

- `DISCOVERABLE` — the system knows the asset exists and can retrieve metadata;
- `CREATIVE_ELIGIBLE` — the promoted shot is safe to use in a creative workflow;
- `MARKETING_READY` — commercial/social marketing use is cleared under current rights and Creative Truth.

A high score never overrides any of these gates.

## Reel selection flow

`USER REQUEST → BRIEF → STORY ARC → REQUIRED STORY FUNCTIONS → VIDEO_SHOTS → ELIGIBILITY GATES → QUALITY/CONTEXT FILTERS → ANTI-REPEAT → WEIGHTED RANKING → EXACT DRIVE FILE IDS → DOWNLOAD SELECTED ORIGINALS ONLY → EDIT / SOURCE-BOUND GENERATIVE MOTION → MASTER → QA → VIDEO_OUTPUTS → VIDEO_USAGE_LOG`.

Canonical story functions include:

`HOOK`, `PLACE_PROOF`, `HUMAN`, `DJ`, `DETAIL`, `CROWD`, `CLIMAX`, `TRACK_NATIONAL`, `TRACK_INTERNATIONAL`, `CIRCULATION`, `HERO`, `CTA_BACKGROUND`, `BROLL`.

If any required story function has no eligible promoted shot, selection returns `VIDEO_COVERAGE_GAP`. It does not substitute an unrelated or rights-blocked asset.

## Ranking policy

Canonical policy: `VIDEO-RANK-1.0` in `VIDEO_RANKING_POLICY`.

Weights:

- Story Function: 25%
- Technical Quality: 20%
- Brief Fit: 20%
- Energy: 10%
- Product/Event: 10%
- Freshness: 5%
- Anti-repeat: 10%

The anti-repeat model reuses the established TOCA OS Sunset media-selector pattern: usage penalty, 7/14/30-day recency factors and visual-cluster penalty.

Thresholds:

- `TOP_PICK >= 85`
- `STRONG >= 75`
- `VALID >= 65`

Scores support editorial selection. They never replace Creative Truth, rights or factual judgment.

## Camera and Drone

Camera and Drone remain logically distinct through `SOURCE_TYPE`, while physical files remain in their source libraries. No duplication is required.

A request can require `CAMERA`, `DRONE`, or use both. The selector returns exact Drive File IDs and source-library identity.

## Anti-repeat and learning

`VIDEO_USAGE_LOG` records exact use of a promoted shot. `video.record_asset_usage` also updates the corresponding `VIDEO_SHOTS` row:

- `USAGE_COUNT`
- `LAST_USED_AT`
- `LAST_USED_IN_REEL`
- `LAST_USED_CAMPAIGN`
- `LAST_OUTPUT_ID`
- `USAGE_PURPOSE`

The next selection uses those values before ranking. Repeated or recently used shots lose score; fresh equivalent shots are preferred.

## MCP surface

`video.select_assets` performs governed selection and writes selection audit rows. It returns:

- coverage status;
- missing required story functions;
- ranked promoted `SHOT_ID`s;
- exact Drive File IDs and URLs;
- source type/library;
- selection score/reason;
- generative eligibility.

It always returns `publicationAuthorized=false`.

`video.record_asset_usage` records exact downstream usage and is idempotent by `usageId`.

## Rights and publication boundary

For `marketingIntent=true`, candidates require `MARKETING_READY=true` and an approved rights state (`OWNED`, `LICENSED`, `CLEARED`, or `RIGHTS_CLEARED`) in addition to Creative Eligibility and Venue Verification.

Generative eligibility is reported but does not itself authorize generation. The existing governed scene-continuation route revalidates source binding, rights, likeness, approval, provider and fidelity gates.

Selection, generation and finalization remain separate from scheduling/publication authority.

## Current library truth

The external libraries have already been discovered/indexed without copying files into TOCA OS. The indexed rows remain `REVIEW_REQUIRED` while hash, technical probe, visual classification, rights, likeness and venue evidence are unresolved. They are therefore discoverable intake, not production candidates.
