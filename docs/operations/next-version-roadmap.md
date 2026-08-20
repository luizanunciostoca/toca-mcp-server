# TOCA OS Next Version — Roadmap

Status: **ACTIVE COORDINATION**  
Round: 2026-08-20 03:40 America/Bahia

This roadmap coordinates implementation. It does not authorize provider/business side effects and does not replace canonical TOCA_OS business policy in Google Drive.

## Permanent guardrails

- V1 is frozen at `abfb09b17e90c83790e803dcda091c8142c7407f` and remains `PRODUCTION_VERIFIED`.
- Live `main` is the dynamic technical baseline.
- Reuse existing TOCA Core, MCP, CRM, scheduler, durable workflow, Policy, Approval, idempotency, Transactional Outbox, Audit Ledger and EventRecord.
- PR #22 is the single commercial `ConversationRecord` / `MessageRecord` authority.
- PR #33 is the single Attribution / Revenue Intelligence workstream.
- WhatsApp must converge from #31/#36 into one final workstream; branch recency alone does not establish ownership.
- Migrations are globally serialized against the actual approved merge queue.
- Temporary/one-shot/repair/formatter workflows never survive in a merge-ready final tree.
- Exact-head evidence is mandatory for every promotion state.
- No provider write/send/activation/payment is executed merely as a validation technique.

## Wave 0 — Central control plane

**#17 coordinator** continuously maintains:

- immutable `V1_BASE_SHA` and live main baseline;
- Feature Registry;
- Master Tracker;
- Evidence Index;
- ownership decisions;
- migration serialization;
- stale/superseded/temporary PR classification;
- dependency-based merge order.

Every material coordinator update must itself finish with exact-head Quality green and no temporary helper remaining in the diff.

## Wave 1 — Transversal authorities and current proven inputs

### Privacy / #19

Land/revalidate #19 early because outbound Email, WhatsApp, Social Engagement and future nurture depend on a single consent/suppression authority.

### Creative Truth / #14 and Demand / #15

- #14 is currently CI-verified and non-Draft.
- #15 is CI-verified plus provider-verified for its READ boundary, with `writeExecuted=false`, and currently owns migration `022` in the proposed queue.
- #16 remains stacked on #14; after #14 merges, retarget/rebase and rerun exact-head Quality.
- #18 Asset Intelligence is CI-verified but must not merge with its conflicting `022`; renumber only when its real predecessor sequence is established, then rerun Quality + PostgreSQL E2E.

## Wave 2 — Security and canonical CRM

### Platform Hardening / #20

Normal Quality is green, but Security Supply Chain is not. Candidate-container scan and dependency review must be fixed without weakening the gate. #20 remains a hard prerequisite for broad AG-01/autonomous operation.

### CRM / #22

#22 is now clean and CI-verified at its current exact head. It owns:

- advanced CRM / sales pipeline;
- canonical Conversation/Message;
- deterministic qualification/scoring;
- sales activity/next action/SLA;
- PostgreSQL persistence over existing CRM/outbox/audit foundations.

No downstream provider may define a second commercial communication ledger. If #15 or another earlier hotspot PR changes `main`, refresh #22 and rerun exact-head Quality + PostgreSQL E2E before merge.

## Wave 3 — Email, Attribution/Revenue and Learning

### Email / #23

#23 reuses #22 Conversation/Message and #19 Privacy. Its prior clean head had Quality + Email Provider Gate + PostgreSQL E2E green, but the active branch advanced again during this round, so only the new active SHA's gates count.

CI readiness and provider readiness remain separate. Production/provider promotion additionally requires real sender/domain/SPF/DKIM/DMARC/secret/webhook/readback/delivery/bounce/complaint/unsubscribe evidence. No Email is sent solely to obtain a green state.

### Attribution / Revenue / #33

#33 is the canonical workstream and is CI-verified on its current exact head. Revenue is established only by confirmed provider-backed `TICKETING | CHECKOUT | PAYMENT | ORDER` evidence. DMs, clicks, UTMs, sessions and opportunity values remain acquisition/intent lineage only.

Migration `028_attribution_revenue_feedback.sql` is unique in the current snapshot but must be renumbered if the final predecessor queue changes.

### R31 / #26

#26 is now CI-verified and clean. It remains recommendation/evidence oriented and performs no unrestricted provider/financial write. Where the final architecture consumes #33 revenue/feedback evidence, integrate #33 before the corresponding R31 wiring and rerun #26 after any material rebase/integration change.

## Wave 4 — AG-01, social, analytics and paid media

### AG-01 / #21

#21 is now clean and CI-verified, and avoids shared runtime hotspots. It still depends on:

- #20 hardening being truly green for its declared security scope;
- #22 final canonical MessageRecord lineage;
- #26 final learning handoff.

After predecessors land, refresh AG-01, revalidate migration numbering and rerun exact-head Quality + PostgreSQL E2E. Provider-side execution remains gated by existing Core/Policy/Approval/readback paths.

### Social Engagement / #24

#24 is CI-verified. Activation waits #19 Privacy + #22 canonical Message/Conversation. Keep existing Meta webhook idempotency and fail closed to Human Required / Suggest Only where policy/consent/approval does not authorize automatic reply.

### Analytics / Capacity / #27

Both PostgreSQL suites are green on the current head, including dedicated Analytics Capacity E2E, but Quality currently fails at Format. Fix formatting without relaxing gates and rerun full Quality. Missing data sources remain `UNAVAILABLE`, never silently zero.

### Paid Media / Google Ads / #28

Current PostgreSQL E2E passes, but Quality fails at Format. Fix and rerun. Continue consuming #15 Demand, #33 Attribution/Revenue and #27 Capacity through typed inputs rather than reimplementing them.

Google Ads provider promotion requires real OAuth/developer-token/account READ/readback evidence. `ACTIVATE` stays separately gated and is never used just to test the integration.

## Wave 5 — Human control, tenancy and WhatsApp convergence

### Human Control Center / #29

#29 is CI-verified, stays on the same MCP server and emits governed AG-01 intent rather than writing providers directly. Dependency cards remain fail-closed until the corresponding Core reads exist. Refresh after predecessor merges if the Core surface changes.

### Multi-tenant foundation / #30

#30 is CI-verified and reuses existing identity/RBAC/ConnectedAccount/SecretResolver/Policy/Approval semantics. It does not create a second control plane. Its remaining structural blocker is migration `027` collision with the WhatsApp lane plus the fact that predecessor domain schemas are still moving.

Immediately before integration, establish the real migration order, renumber if needed and rerun exact-head Quality + PostgreSQL E2E after any renumber/rebase.

### WhatsApp / #36

#25 is correctly closed unmerged because it carried an obsolete duplicate CRM communication model. PR #36 is now the sole converged merge source stacked on canonical #22; PR #31 is closed unmerged and superseded. The convergence preserved the strongest safe semantics from both candidates:

- from #31: explicit runtime audit evidence, recipient-to-canonical-Contact channel validation, ambiguity-aware CRM resolution and sales activity for human handoff;
- from #36: provider media metadata readback and unmatched-status workflow handoff;
- from both: canonical Message/Conversation IDs, Privacy/Policy/Approval gate, throttle, retry/idempotency, 24h service window, approved templates, callbacks/readback, dead-letter/human handoff, existing Meta HMAC boundary and existing Outbox/Audit persistence.

PR #36 exact-head Quality `32339737876` and PostgreSQL E2E `32339737890` are green. Resolve the `027` migration collision with #30 before merge, then pursue WABA/scopes/Phone Number ID/template/callback/readback provider evidence separately.

## Migration serialization

Observed `main` ends at `021_r29_video_artifacts.sql` in this round. Active collision points are:

- `022`: #15 vs #18;
- `027`: #30 vs the final WhatsApp branch.

The old #25 `024` collision is gone because #25 is closed unmerged. #23 currently reserves `024`, #26 `025`, #21 `026`, and #33 `028`, subject to the real integration sequence.

Before every migration-bearing integration:

1. re-read live `main` migrations;
2. list earlier approved migration-bearing PRs in actual merge order;
3. assign the next monotonic number;
4. update references/tests/docs;
5. rerun full exact-head Quality + PostgreSQL E2E;
6. never force another branch around a conflicting number.

## Current governed merge order

No automatic merge is authorized. Current dependency-based order:

1. #17 control plane after final exact-head Quality.
2. #19 Privacy.
3. #14 Creative Truth.
4. #15 Demand Intelligence / migration `022`.
5. #20 after Security Supply Chain is fully green.
6. #22 CRM/Sales / migration `023`, refreshed after earlier hotspot merges if needed.
7. #16 after #14 merge + retarget/revalidation.
8. #23 Email / migration `024`, after #19/#22 and exact active-head gates.
9. #33 Attribution/Revenue after applicable CRM integration + global migration serialization.
10. #26 R31/Learning after #33 if final feedback wiring is included.
11. #21 AG-01 after #20/#22/#26.
12. #24 Social Engagement after #19/#22 and refresh.
13. #27 Analytics/Capacity after Quality is green.
14. #28 Paid Media/Google Ads after #15/#33/#27 and Quality is green.
15. #29 Human Control Center after dependency cards are reconciled.
16. #18 Asset Intelligence after resolving `022` and Creative Truth integration, with post-renumber gates.
17. #30 Multi-tenant after predecessor schemas/migrations stabilize.
18. PR #36 WhatsApp after #22/#19, migration serialization and fresh exact-head gates.
19. Dependabot #1–#6 remain separate maintenance work.

Recompute after every merge, rebase, renumber or material head change.

## Safe parallel work

May proceed without creating competing authorities:

- capability/data-governance reconciliation;
- Email/WhatsApp provider configuration and read-only preflight preparation, without real send solely for testing;
- real conversion/ticketing/checkout evidence adapters feeding #33 through existing Measurement/CRM roots;
- observability/DR tests extending #20;
- cross-domain integration tests proving #22 MessageRecord reuse by Email/WhatsApp/Social/AG-01;
- migration-queue inspection tooling that never mutates feature branches automatically.

Do not open another CRM, Conversation/Message model, WhatsApp implementation, Email implementation, scheduler, Policy Engine, Approval Engine, attribution system, MCP or parallel persistence authority.

## Merge-ready definition

A Next Version PR is merge-ready only when it is on the correct current base/stack, mergeable, free of duplicate ownership and temporary workflows, globally migration-consistent, exact-head Quality green, PostgreSQL E2E green when applicable, retry/idempotency evidence present when applicable, provider readback matches any provider claim, and no evidence state is overstated.
