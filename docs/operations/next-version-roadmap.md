# TOCA OS Next Version — Roadmap

Status: **ACTIVE COORDINATION**  
Round: 2026-08-20 02:32 America/Bahia

This roadmap coordinates implementation. It does not authorize side effects and does not replace canonical Google Drive business policy.

## Guardrails

- V1 remains frozen at `abfb09b17e90c83790e803dcda091c8142c7407f` and `PRODUCTION_VERIFIED`.
- Live `main` is the technical baseline for every new or refreshed integration decision.
- Reuse existing TOCA Core, MCP, CRM, scheduler, durable workflows, Policy Engine, Approval Engine, idempotency, outbox, audit and EventRecord.
- PR #22 is the canonical owner of commercial `ConversationRecord` / `MessageRecord`.
- Only one WhatsApp workstream may survive; #31 is the intended owner after preserving unique useful behavior from #25.
- No provider write is used merely as a test.
- Exact-head evidence is mandatory for every promotion state.
- Temporary/one-shot/repair workflows must not exist in the final merge-ready tree.
- Migrations are globally serialized against the actual merge queue.

## Phase 0 — Coordination and convergence

### P0.1 Control plane

- Maintain `V1_BASE_SHA` as immutable release identity.
- Maintain `control/next-version-feature-registry.v1.json`.
- Maintain PR/branch/dependency/evidence tracker.
- Maintain release/evidence index continuously.
- Re-read `main`, open PRs, heads, migrations and workflows before every integration decision.
- Mark stale/superseded branches as non-merge sources only after unique required behavior is deliberately compared and preserved.

### P0.2 Current creative and demand wave

1. **#14 Creative Truth** — current exact head is CI green and non-Draft.
2. **#15 Demand Intelligence** — current exact head is provider-verified for the READ boundary and owns migration `022` in the current queue.
3. **#16 Photo-to-Video** — CI green but stacked; after #14 merges, retarget/rebase to resulting `main`, verify the net child diff and rerun exact-head Quality.
4. **#18 Asset Intelligence** — CI green but blocked by its conflicting `022`; renumber only after the preceding migration queue is fixed, then rerun Quality + PostgreSQL E2E.

No provider mutation is introduced merely to promote these branches.

## Phase 1 — Transversal governance and business state

### P1.1 Privacy

**#19 Privacy / LGPD** is the canonical transversal consent/suppression authority for downstream outbound channels. Provider opt-out observations may reconcile canonical suppression, but provider opt-in never fabricates business consent.

### P1.2 Platform hardening

**#20 Platform Hardening** remains a hard prerequisite for AG-01 and broad autonomous operation. Normal Quality is green, but Security Supply Chain must be fully green before the hardening front is considered CI-verified for its declared scope.

Current security blocker: candidate-container scan and dependency review fail; CodeQL passes.

### P1.3 CRM / Sales / Conversation / Message

**#22 Advanced CRM** is the canonical owner for:

- Contact → Lead → Opportunity expansion;
- sales pipeline state;
- `ConversationRecord`;
- `MessageRecord`;
- sales activity / next action / qualification / score / attribution support;
- canonical PostgreSQL persistence, idempotency, audit and outbox integration.

Its current code gates are green, but `.github/workflows/crm-sales-catalog-one-shot.yml` remains in the diff. Remove it and rerun exact-head Quality + PostgreSQL E2E before merge readiness.

No channel PR may introduce a second commercial Conversation/Message ledger.

## Phase 2 — Channels and external AG-01

### P2.1 Email

**#23 Email / SendGrid** remains stacked on #22 and also depends on #19. Its own Email subgraph passes, but the overall provider gate is red because the parent snapshot was stale. Required sequence:

1. clean/stabilize #22;
2. restack #23 on the exact final #22 head;
3. rerun normal Quality + Email Provider Gate + PostgreSQL E2E;
4. configure real sender/domain/SPF/DKIM/DMARC/secrets without bypassing fail-closed binding;
5. obtain controlled provider read/readback/delivery evidence only under policy/approval;
6. promote provider state only after the matching evidence exists.

### P2.2 WhatsApp

Two competing branches exist. The canonical convergence path is:

1. compare #25 and #31 deliberately;
2. preserve any unique useful provider/webhook/throttle/retry behavior from #25;
3. keep #22 as the commercial Conversation/Message owner;
4. use #31 as the intended provider workstream because its WhatsApp persistence is transport-sidecar state referencing canonical CRM IDs;
5. remove #31 `.github/workflows/format-whatsapp-stack-once.yml`;
6. refresh #31 onto the exact clean #22 head and #19 Privacy boundary;
7. resolve its migration collision globally;
8. rerun exact-head Quality + PostgreSQL E2E;
9. obtain WABA/scopes/Phone Number ID/template/callback/readback evidence before provider promotion.

PR #25 is a superseded candidate only after preservation review; do not merge its duplicate CRM communication model.

### P2.3 AG-01

**#21 AG-01** remains external to the MCP's deterministic provider-execution role and must reuse TOCA Core execution, Approval/Policy, CRM IDs, audit/outbox and R31 handoff.

Before merge readiness:

- remove `.github/workflows/ag01-type-repair.yml`;
- land/reconcile #20 hardening;
- reconcile canonical #22 MessageRecord lineage;
- reconcile #26 learning handoff without copying the learning engine;
- reserialize migration number if earlier migrations move;
- rerun exact-head Quality + PostgreSQL E2E.

## Phase 3 — Learning, analytics and attribution

### P3.1 R31 / Marketing Autopilot

**#26** owns the current R31 learning/experimentation front and reuses the existing scheduler/worker rather than creating another scheduler. Its PostgreSQL E2E is green, but Quality fails at Format. Fix formatting without weakening gates, then rerun the full exact-head suite.

R31 remains recommendation/evidence driven. It does not perform direct provider or financial writes.

### P3.2 Analytics / Capacity

**#27** provides read-only Analytics and Capacity read models over existing Measurement/CRM/Ticketing/Publication/Audit data. Current blockers:

- Quality fails at Format;
- dedicated Analytics Capacity PostgreSQL E2E fails its functional execution step.

Both must pass before CI verification. Missing sources remain unavailable rather than zero.

### P3.3 Conversion / attribution

Continue only as canonical extensions of existing Measurement/CRM/ticketing roots. `WON` and realized revenue require external conversion/ticketing/payment evidence where applicable; never infer them from a DM, offer, click or checkout-start alone.

## Phase 4 — Closed-loop paid media and social

### P4.1 Social Engagement

**#24** is CI-verified but activation depends on #19 Privacy and #22 canonical Conversation/Message. Refresh it after those predecessors land, preserve existing Meta webhook idempotency and execute no automatic reply unless the established policy/consent/approval gates allow it.

### P4.2 Paid Media / Google Ads

**#28** is the active Paid Media/Google Ads workstream. It must continue to consume #15 Demand through typed input and attribution/revenue evidence rather than recreate either domain.

At this round's readback, head `579e6e402e860c20ce428277c836f5ae9488a857` had Quality `32336319196` and PostgreSQL `32336319232` still in progress and was not mergeable. Re-read before any decision.

Google Ads `ACTIVATE` remains a separate governed capability and must never be activated merely as a validation technique.

## Phase 5 — Human control, tenancy and operability

### P5.1 Human Control Center

**#29** is CI-verified and remains on the same MCP server. The UI emits governed AG-01 intent rather than writing provider/business state directly. Cards that depend on unavailable Core reads remain fail-closed.

After predecessor merges, reconcile cards against the current registry/runtime and rerun exact-head Quality if the branch changes.

### P5.2 Multi-tenant foundation

**#30** reuses existing identity/RBAC/ConnectedAccount/SecretResolver/policy/approval semantics and must not become a second control plane. Current blockers:

- current live head is format-red;
- migration `027` collides with #31;
- dependent CRM/AG-01/asset domains are still moving.

Before merge, reserialize the migration against the actual predecessor set and rerun Quality + PostgreSQL E2E on the exact final head.

### P5.3 Security / observability / DR

Extend #20's platform contracts and existing Foundation/SLO/Cloud SQL recovery evidence. Do not introduce a second observability backend or a separate DR state authority.

## Migration serialization rule

Observed `main` ends at `021_r29_video_artifacts.sql` in this round. Current open-branch collisions include `022`, `024` and `027`.

The coordinator does **not** assign numbers by PR creation time alone. Immediately before a migration-bearing PR enters the merge queue:

1. read live `main` migrations;
2. read all earlier migration-bearing PRs in the approved merge order;
3. assign the next monotonically correct number;
4. update all references/tests/docs;
5. rerun exact-head Quality + PostgreSQL E2E;
6. never merge a branch whose migration number collides or would later create out-of-order production application.

## Shared-hotspot policy

Before modifying any of these files, inspect parallel PRs and isolate integration changes when possible:

- `src/server.ts`
- `src/registry.ts`
- `src/mcp/runtime-capability-resolver.ts`
- `src/mcp/core-execution.ts`
- `src/http-server.ts`
- `scripts/architecture-check.mjs`
- `package.json`
- permanent CI workflows

Current hotspots are especially concentrated in #15, #22, #25 and #29. The #14/#16 pair is a parent-child stack and must preserve both parent semantics and child extensions.

## Definition of a merge-ready Next Version PR

A PR is merge-ready only when:

- refreshed from the live intended base;
- 0-behind its intended base or correctly stacked on the exact parent;
- mergeable;
- free of temporary/diagnostic/repair/one-shot workflow residue;
- free of duplicate domain ownership;
- migration number is globally consistent;
- Quality is green on the exact final HEAD;
- PostgreSQL E2E is green where persistence/migrations are involved;
- restart/retry/idempotency evidence is present when applicable;
- provider READ/readback evidence matches the claimed evidence state;
- provider/business side effects were not executed solely to manufacture evidence;
- dependencies and merge order are documented;
- no evidence state is overstated.

No automatic merge to `main` is authorized by this roadmap.
