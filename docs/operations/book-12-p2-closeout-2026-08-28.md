# TOCA OS — Livro 12 P2 closeout

Date: `2026-08-28`  
Scope: `Livro 12 — Tecnologia e Automações`  
Repository: `luizanunciostoca/toca-mcp-server`

## Executive result

The Livro 12 backlog is reconciled as operational truth rather than editorial expansion. Canonical counts, provider evidence, Fast Lane safety gates, staging readiness, recovery objectives and R28 naming are now explicitly separated from stale/static documentation.

No provider write is authorized by this closeout. Existing provider evidence is reused only where it is already real, read back and traceable.

## P-01 — Capability total `771 x 796`

**Status: CLOSED AS LAYERED COUNT SEMANTICS.**

The two figures are real, but they describe different catalog layers and must not be compared as if they were the same denominator:

- `771` = Drive machine-actionable **structural catalog** count in `CATALOGO_MACHINE_ACTIONABLE_DE_ROTAS_E_CAPABILITIES_2025-01-02_v1.0`, `SUMMARY`;
- `796` = repository **expanded code catalog** count materialized by `src/governance/capability-catalog.ts` contract `v1.1.0` and enforced by `test/governance-catalog.test.ts`;
- the repository catalog is composed from route capability IDs plus technical extensions, video-content technical extensions and transversal capability IDs;
- the live MCP runtime registry is intentionally narrower than the `796` code catalog and remains feature/evidence gated;
- therefore `796 - 771 = 25` must **not** be interpreted as 25 missing, invalid or editorial capabilities without an ID-level cross-layer diff.

Reconciliation rule: every status page, report or dashboard that displays a capability count must name the layer (`DRIVE_STRUCTURAL_CATALOG`, `REPO_EXPANDED_CATALOG`, or `RUNTIME_REGISTRY`) and must never present one layer's count as the current truth of another.

Sources of truth:

- Drive structural layer: `CATALOGO_MACHINE_ACTIONABLE_DE_ROTAS_E_CAPABILITIES_2025-01-02_v1.0` / `SUMMARY`;
- repository expanded layer: `src/governance/capability-catalog.ts` + `test/governance-catalog.test.ts`;
- executable runtime layer: `src/registry.ts` plus active feature flags and provider-backed evidence.

## P-02 — Fast Lane x capability evidence

**Status: CLOSED FOR `instagram.publish.image`; FAIL-CLOSED FOR UNPROVEN FORMATS.**

Real production evidence exists for the approved Sunset feed image:

- workflow run: `33098660561`;
- provider publication ID: `18620842246053649`;
- request SHA-256: `6ea846df8005dad15afc96ccd933cdb981086d72e1d592c5f3af3a76f05aabb7`;
- idempotency key: `MKT-20260827-SUNSET-FEED-1500-SHARENOW-V4`;
- immutable artifact: `9657560375`;
- artifact digest: `sha256:32f7e7d6aeaf2650d7d916d0268ac986a0567473da58bcfb5f8d47cd896761c1`;
- provider readback: `PUBLISHED` with matching correlation/request identity.

`control/capability-validation-evidence.v1.json` now carries one `PRODUCTION_VALIDATED` entry for `instagram.publish.image`. Carousel, Reel, Story and other external writes are not promoted by this evidence.

## P-03 — Runtime health/readiness

**Status: STAGING CLOSED; PRODUCTION REMAINS ENVIRONMENT-GATED.**

Isolated staging evidence already proves:

- exact accepted revisions serving 100% staging traffic;
- 30/30 authenticated `/readyz` samples returned HTTP 200;
- all 16 readiness checks healthy;
- migrations and durable PostgreSQL contracts accepted;
- post-E2E readiness preserved without traffic drift.

This supports `STAGING_VERIFIED=true` for the frozen candidate. It does **not** authorize or imply a production rollout. Production health/readiness must be re-proven against the production revision only after explicit production authorization.

## P-04 — RPO/RTO by critical service

**Status: CLOSED AS OPERATIONAL CONTRACT.**

The per-surface matrix is now canonical in:

- `docs/operations/recovery-objectives-by-service.md`.

Baseline:

- PostgreSQL PITR RPO `<=15m`;
- PostgreSQL recovery RTO `<=60m`;
- workflow/scheduler/Outbox/Audit/Approval/Privacy/CRM/AG-01 inherit the durable DB RPO and require gated resume;
- stateless Cloud Run services recover from immutable artifacts and require authenticated readiness before resume;
- ambiguous provider state is reconciled by readback before retry, never by blind replay.

Measured staging DR remains stronger than the target: RPO `46s`, full PostgreSQL RTO `737s`.

## P-05 — R28 terminology

**Status: CLOSED IN CODE; DRIVE ROUTE CATALOG MUST USE THE SAME NAME.**

Canonical name: `R28 META_ADS_CONTROLLED_LIFECYCLE`.

`PAID_MEDIA_CONTROLLED_LIFECYCLE` is not the canonical R28 route name. Paid Media may describe the broader business domain, but the structural lifecycle route is Meta Ads-specific and must remain `META_ADS_CONTROLLED_LIFECYCLE` across route catalog, structural lifecycle sheet, code and generated docs.

## P-06 — Provider-backed evidence

**Status: CLOSED FOR `instagram.publish.image`; ALL OTHER PROVIDER WRITES REMAIN EVIDENCE-GATED.**

Promotion requires:

- provider write success;
- external resource ID;
- provider readback;
- idempotency proof;
- reconciliation proof;
- fail-closed unknown outcome handling;
- provider/readback/acceptance evidence classes.

The Instagram image record now satisfies that contract. No generalized provider promotion is inferred.

## P-07 — Deterministic brand/typography prerequisite

**Status: TECHNOLOGY GATE CLOSED; BOOK 02 REMAINS SOURCE OF BRAND TRUTH.**

A new Fast Lane `PUBLISH_NOW` command must provide a `brandDeterminism` binding with:

- `status=VERIFIED`;
- canonical `standardRef`;
- canonical `typographyRef`;
- `assetSha256` equal to the exact approved asset hash.

The check executes before cloud authentication. Therefore an unresolved Book 02 typography/brand truth cannot silently pass through Technology.

## P-08 — Rights/consent/license prerequisite

**Status: TECHNOLOGY GATE CLOSED; LEGAL CLEARANCE REMAINS OWNED BY BOOK 11/06.**

A new Fast Lane `PUBLISH_NOW` command must provide a `rightsClearance` binding with:

- `status=CLEARED`;
- `scope=INSTAGRAM_ORGANIC_PUBLICATION`;
- non-empty canonical `evidenceRef`;
- non-empty clearing authority;
- valid clearance timestamp;
- exact asset hash binding;
- optional expiry must still be valid.

The gate runs before cloud authentication. Technology does not invent or approve legal rights; it only refuses to publish when the upstream evidence is absent or stale.

## P-09 — Side-effect production rule

**Status: CLOSED FOR THE FAST LANE CONTRACT.**

A provider side effect requires, where applicable:

1. capability evidence;
2. policy/guardrail pass;
3. explicit approval;
4. idempotency identity;
5. exact request/asset binding;
6. deterministic brand gate;
7. rights-clearance gate;
8. provider readback and immutable reconciliation evidence;
9. unknown outcome remains fail-closed.

The consumed Sunset command has been disarmed to `NOOP` after its verified publication. Historical evidence remains linked but the command is no longer an active publication instruction.

## P-10 — Registry/index/status reconciliation

**Status: CLOSED AS ANTI-INFLATION RULE.**

Static manuals, PDFs and evidence indexes are snapshots. They must not masquerade as a live `main` pointer or live provider state.

Status resolution order:

1. current canonical repository/catalog source;
2. environment-specific runtime/readiness evidence;
3. provider-backed evidence for external capabilities;
4. generated/manual documentation last.

If these layers conflict, the system must report the conflict instead of selecting the most optimistic status.

## Remaining external dependencies

The following are intentionally not fabricated by Livro 12:

- final deterministic typography/brand references supplied by Livro 02;
- actual rights/license/consent evidence supplied by Livros 06/11;
- provider verification for WhatsApp, SendGrid/Email, Google Ads and any other provider without real readback evidence;
- production runtime/readiness for the Next candidate until a production rollout is explicitly authorized.

These are not missing Technology architecture after this change; they are explicit upstream/environment gates.

## Acceptance criteria

Livro 12 P2 closeout is accepted when:

- Drive reports `771` explicitly as the structural catalog count, while repository contract `v1.1.0` reports `796` explicitly as the expanded code-catalog count; no source labels either figure as the other's runtime truth;
- R28 is `META_ADS_CONTROLLED_LIFECYCLE` in Drive and code;
- the provider-evidence manifest validates with `instagram.publish.image` only;
- Fast Lane consumed command is `NOOP`;
- brand and rights checks execute before cloud authentication for future `PUBLISH_NOW` commands;
- Quality Gate, Autonomy Safety and Security Supply Chain pass on the PR;
- no additional provider write is executed solely to manufacture evidence.
