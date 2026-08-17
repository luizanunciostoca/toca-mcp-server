# TOCA OS V1 — Canonical Repository and Capability State — 2026-08-17

Status: **AUDITABLE V1 CANONICAL INVENTORY / CI_VERIFIED PENDING FINAL GITHUB ACTIONS ROUND**

## Source-of-truth snapshot

- repository: `luizidebook/toca-mcp-server`;
- canonical branch inspected before this closeout: `main`;
- canonical SHA at audit start: `868c64ac0dcfa4c2b28994198b1a8c9af87f7a7c`;
- open pull requests at the authoritative REST recheck: only PR #185, `fix/v1-instagram-direct-publication`;
- PR #185 is feature work and is explicitly outside this governance closeout; its unmerged capability changes are **not** part of the V1 canonical state recorded here;
- GitHub Actions is unavailable for the current closeout round. Therefore `CI_VERIFIED` for this branch/current final head is **PENDING**, regardless of historical green runs.

This file is the release-evidence overlay for the structural capability catalog. Catalog presence, a capability spec, an implementation module, a lifecycle label or an old successful CI run does not by itself prove current executability.

## V1 release-evidence vocabulary

The repository keeps its existing runtime lifecycle vocabulary for compatibility. This closeout uses the following evidence vocabulary without changing runtime enums:

| Evidence state | Meaning |
| --- | --- |
| `PLANNED` | intent/specification exists, but the executable implementation/binding is not complete |
| `IMPLEMENTED` | meaningful code exists, but the complete governed execution path is not yet proven complete |
| `CODE_COMPLETE` | code and required in-repository binding path are complete for the stated scope; no provider/production claim is implied |
| `LOCAL_VERIFIED` | exact implementation has passed deterministic local/direct validation for the stated scope |
| `PROVIDER_VERIFIED` | exact bounded operation has been verified against the real external provider, with required readback/evidence |
| `PRODUCTION_VERIFIED` | exact bounded capability/runtime path has production evidence on a concrete deployment/runtime identity |

`CI_VERIFIED` is an **orthogonal evidence flag**, not a capability maturity state. For this closeout it remains `PENDING_FINAL_ACTIONS_ROUND` until GitHub Actions returns and the final exact head is green.

Promotion is evidence-backed and scope-specific. A broader capability family must not inherit a stronger status from a narrower proven operation.

## Executability rule

A capability may be called executable only when all of the following are true for the requested surface:

1. implementation exists;
2. the runtime resolver/handler binding exists;
3. the binding is side-effect validated when the capability mutates state;
4. the capability is registered on the intended runtime surface;
5. required feature/config/provider gates are satisfied;
6. policy/approval boundaries permit the requested operation;
7. the evidence state supports the claim being made.

A catalog-only entry, a `PLANNED` registry entry, a disabled feature gate, a non-validated side-effect binding, a missing provider configuration or an unmerged PR is **not executable**.

## Canonical V1 capability truth

| Area / bounded scope | Canonical evidence state | Executable in canonical V1? | Provider / production truth | V1 disposition |
| --- | --- | --- | --- | --- |
| Foundation/Core governed path: identity, typed schema, authorization/policy/risk, approval binding, idempotency, durable workflows, PostgreSQL restart safety, transactional outbox retry, EventRecord/CRM linkage, Audit Ledger, `toca.execute` / `toca.verify` | `PRODUCTION_VERIFIED` for the bounded merged Foundation path | Yes, where registered and enabled by the runtime | M-FND-12 exact final candidate had Quality, PostgreSQL E2E and provider READ green; merged evidence proves restart/outbox/audit and real Meta/Instagram READ. Current closeout CI is still pending. | V1 |
| TOCA-managed Instagram scheduler `prepare/create/cancel/status/list` | `PRODUCTION_VERIFIED` for the already validated scheduler subset | Yes when `tocaManagedInstagramSchedulerEnabled` is enabled | Canonical registry and existing merged runtime evidence support this subset. | V1 |
| `instagram.toca_schedule.reschedule` on canonical `main` | `CODE_COMPLETE` but **NOT EXECUTABLE through the governed Core binding** | **No** | The runtime registry label overstates current executability: the existing `main` resolver binding has `sideEffectValidated: false`. PR #185 changes that flag to `true` and adds exact binding tests, but it is unmerged and therefore cannot be counted. | V1 current truth; feature closeout handled by PR #185 |
| Instagram direct publication `instagram.publish.image/carousel/reel/story` | `PLANNED` on canonical `main` runtime surface | **No** | Provider/publication implementation history exists, but canonical `main` still registers these four direct tools as `PLANNED`. PR #185 is not merged and cannot be used to promote V1 truth. | V1 current truth; feature closeout handled separately |
| Instagram structural publication aliases (`instagram.publication.*`) | `PLANNED` on canonical `main` runtime surface | **No** unless a separate already-validated internal path is invoked through its own surface | Canonical registry keeps these declarations planned. | V1 current truth |
| Instagram / Meta read surfaces | `PROVIDER_VERIFIED` / `PRODUCTION_VERIFIED` for the exact provider READ evidence already merged | Yes only when the relevant read flags/scopes are enabled | M-FND-12 provider READ verified production runtime identity, scopes, Page→Instagram binding and recent real media. | V1 |
| Meta Ads read capabilities | `PROVIDER_VERIFIED` for the validated account/read boundary | Yes only with `metaAdsReadsEnabled` and required scopes | Real account/provider validation is recorded in the Meta Ads final provider evidence. | V1 |
| `meta_ads.campaign.prepare_paused` | `PRODUCTION_VERIFIED` operationally for the controlled prepare boundary | Controlled/internal only | Exact deterministic PREPARE was validated before the provider mutation. | V1 |
| `meta_ads.campaign.create_paused` | `PRODUCTION_VERIFIED` for the **strict PAUSED-only controlled scope**; runtime registry intentionally remains `IMPLEMENTED` | Not a generic/public write surface | Real provider `READ -> PREPARE -> CREATE_PAUSED -> independent exact-ID READBACK` succeeded; campaign, Ad Set and Ad remained PAUSED; spend proof was BRL 0.00; no activation occurred. | V1 |
| Meta Ads activation, generic unattended writes, budget expansion or blind retry after ambiguous provider state | `PLANNED` / not validated for generic execution | **No** | Explicitly outside the validated Meta Ads boundary. | Not part of V1 executable claims |
| R29/video internal runtime capabilities represented by `VIDEO_CONTENT_CAPABILITY_CONTRACT_OVERRIDES` | `PRODUCTION_VERIFIED` in the canonical runtime registry | Yes when `videoContentRuntimeEnabled` is enabled | No inference is made from the label alone for external publication; R29 is an internal content lifecycle/runtime scope. | V1 |
| Google Ads in-repository implementation/resolver path | `CODE_COMPLETE` for the repository implementation scope | **No live provider execution claim in V1** | `src/registry.ts` contains phase-gated Google Ads tool definitions, but production provider configuration/binding was not present in the operational closeout and no real provider READ/WRITE was accepted as V1 evidence. | **DEFERRED / NEXT_VERSION**; not a V1 blocker |
| Google Ads real provider READ / PREPARE / CREATE_PAUSED / READBACK / MANAGE | `PLANNED` as a live-provider release scope | **No** | No V1 provider verification or production verification claim. | **DEFERRED / NEXT_VERSION** |
| Omnichannel contracts / privacy-governed messaging model | `CODE_COMPLETE` for the contract/specification layer | No real provider send surface | Contract work is present, but it does not constitute WhatsApp or Email provider execution. | V1 contract foundation only |
| Real WhatsApp provider execution | `PLANNED` | **No** | No executable provider binding/readback is claimed. | **DEFERRED / NEXT_VERSION**; not a V1 blocker |
| Real Email provider execution | `PLANNED` | **No** | No executable provider binding/readback is claimed. | **DEFERRED / NEXT_VERSION**; not a V1 blocker |

## Evidence anchors

The most important existing evidence remains authoritative only for its exact scope:

- `docs/checkpoints/m-found-12-e2e-production-validation.md` plus merged PR #119: exact-head Foundation Quality, PostgreSQL restart/outbox/audit E2E and production-runtime Meta/Instagram provider READ;
- PR #185 diff: proves the current-main `instagram.toca_schedule.reschedule` binding is still `sideEffectValidated: false` and that promotion work is unmerged;
- `docs/operations/meta-ads-final-provider-validation-2026-08-16.md`: exact controlled Meta Ads provider chain and independent readback;
- `src/registry.ts`: current canonical runtime registration, feature/phase gating and direct-publication `PLANNED` truth;
- `src/governance/capability-catalog.ts`: structural catalog metadata; it is not independent proof of runtime executability;
- `docs/operations/google-ads-operational-closeout.md` and `docs/operations/omnichannel-operational-closeout.md`: deferred provider scope and absence of V1 live-provider completion.

## Known canonical drift requiring feature-side resolution

`src/registry.ts` currently labels all six `instagram.toca_schedule.*` tools `PRODUCTION_VALIDATED`, while `instagram.toca_schedule.reschedule` is not side-effect validated in the canonical Core binding. This closeout **does not change feature code or preempt PR #185**. Until that PR (or a superseding verified implementation) is merged, the executable truth is the stricter one recorded here: `reschedule` is not executable through the governed Core surface.

## Current CI truth

Historical green runs remain valid evidence for the exact historical SHAs they validated. They do not make this governance branch or a future merge head `CI_VERIFIED`.

The final V1 closeout must record `CI_VERIFIED=TRUE` only after GitHub Actions is available again and the final exact head passes the repository's required gates. Until then:

`CI_VERIFIED = PENDING_FINAL_ACTIONS_ROUND`

This pending CI flag does **not** convert Google Ads or Omnichannel real-provider work into V1 blockers; both are explicitly next-version scope. It also does not erase previously proven provider/production evidence for narrower unchanged capabilities.
