# AG-01 internal specialist missions — controlled WorkflowStore bridge

## Proven base and scope

Baseline: `luizanunciostoca/toca-mcp-server:main` at `d4dad13cdae4ff720a572adfe63f5d3d4f88b1a1` (2026-10-14).
Control Plane claim: `#639`, `AG01-INTERNAL-SPECIALIST-MISSIONS-WORKFLOWSTORE-20261014`; separate from existing held GCP/webhook/publishing locks. Owner authorization: `#985` (repository-only). Source integration is tracked through protected GitHub PR [#1051](https://github.com/luizanunciostoca/toca-mcp-server/pull/1051). The initial client block on branch creation was subsequently cleared through the same authorized connector. Source review and CI do not imply deployment or runtime/provider execution proof.

## Supported interface, no external ChatGPT tasks

Only the existing `WorkflowStore` + `CoreCapabilityGateway` are used. ChatGPT Tasks do not have an established external AG-01 task-create/task-trigger/status/ACK interface in this environment. `NOT_INTEGRATED` for ChatGPT-to-ChatGPT task invocation must remain distinct from internal Core runtime capability execution. ChatGPT-side scheduled tasks are not changed by this design.

Flow (opt-in): `AG-01 checkpoint decision (existing) -> internal mission manifest -> WorkflowStore.create -> claimReadySteps(owner) -> Core.inspect/execute -> actual Core executionId -> WorkflowStore.completeStep -> AG-01 result`. Existing Core policy, approvals, provider paths, readback and audit remain authoritative. An executor acknowledges **only its own** actual invocation; creating/claiming a workflow is not provider ACK. `WorkflowStore` remains owner of step state and Postgres transactional outbox. This design introduces no scheduler, queue, event bus, provider adapter, registry, advisory GitHub-comment lock, or independent Approval Store.

## Minimum envelope and state mapping

| Mission property                                                                | Persisted location / rule                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mission_id`                                                                    | deterministic WorkflowInstance.workflowId from tenant and idempotency key                                                                                                          |
| `routeId`, `capability`, `owner`, `priority`, `correlationId`, `idempotencyKey` | immutable WorkflowInstance.input manifest; identity principal/tenant/workspace/org bound to workflow                                                                               |
| `expiresAt` / TTL                                                               | manifest checked before claim (no new scheduler); the orchestration checkpoint persists an immutable `missionCreatedAt` anchor so replay cannot silently extend expiry             |
| `payloadSha256` and `immutableSha256`                                           | replay conflict detection (no duplicate provider call)                                                                                                                             |
| `READY`                                                                         | step READY                                                                                                                                                                         |
| `CLAIMED` / `STARTED`                                                           | existing WorkflowStore atomic step claim immediately sets `claimedAt` **and** `startedAt`; STARTED is internal worker state, not provider ACK; no synthetic distinct claimed event |
| `DONE`                                                                          | only after `Core.execute` returns a valid executionId/capability and `WorkflowStore.completeStep` persists it                                                                      |
| `FAILED`                                                                        | Core exception followed by `WorkflowStore.failStep`; post-Core storage uncertainty stays RUNNING until reconciled                                                                  |
| `providerReadbackVerified`                                                      | always false in this READ-only bridge: Core ACK is not independent provider verification                                                                                           |

### Fail-closed boundaries

- AG-01-primary routes retain the existing direct Core path; the specialized branch is used only when an eligible non-AG-01 route owner exists.
- **Only registered, READ-risk Core capabilities** with sideEffects=false and approvalRequired=false are currently eligible. Generated media, publishing, Direct/Comment, Meta campaign creation/spend and irreversible actions stay on their pre-existing pathways, awaiting separate scoped approvals and provider proof.
- Must pass route/capability catalog, runtime `Core.inspect`, tenant/principal/route/capability authorization, owner membership and unexpired TTL. No user prompt may grant itself a route or worker principal.
- No `google_ads.*`, `whatsapp.*` or `email.*` dispatch.
- At-most-one `Core.execute` attempt per claim (`maxAttempts=1`). No automatic reclaim from an ambiguous RUNNING state, no blind retry after timeout/disconnect. Core's existing idempotency/approval/provider reconciliation are not replaced.
- Readable manifest does not contain provider secrets. Claim `executionId` is required for completion/failure. The canonical worker context is internal to the same AG-01 runtime and cannot be triggered from any new unauthenticated HTTP endpoint.
- No runtime flag defaults to enabled. To enable **after protected merge and exact-head tests**, set existing runtime environment `TOCA_AG01_INTERNAL_SPECIALISTS_ENABLED=true` via a separately authorized deployment/change process; default remains `false`. No production service mutation is in this package.

## Cross-domain campaign example (design only)

- Fotos / visual curation (`R03`, AG-06): read-only metadata/quality validation if runtime-bound.
- Photo processing (`R04`, AG-07) and video (`Rxx` canonical): read-only inspections and QA; edits/generation need separate Core policy/approval and remain excluded here.
- Copy (`R05`, AG-04): grounded READ-only brand/factual checks when runtime-bound; generated text needs approved future expansion.
- QA (`R01/R04`, route-specific owner): read-only compliance, metadata and proof checks.
- Meta Ads (`R08`, owner from live route registry): diagnostics/read-only analytics only, no new campaigns/spend/budget changes.
- Analytics (canonical Rxx): verified READ-only metrics; no ungrounded reporting.

Create a mission on its owning route, with a stable idempotency key per campaign/item/capability. Existing dependent workflow-step relationships, if needed, should remain within the **existing** WorkflowStore; do not create a global queue. A mission that is externally unclaimed/invalid/expired remains gated. Final activity returns to the original AG-01 checkpoint through the existing result path, not to a new scheduler. Priority is currently **metadata**, not a new preemptive scheduling algorithm: `WorkflowStore` retains its canonical claim selection ordering. There is no claim of simultaneous ChatGPT agent execution.

## Required acceptance before turning on

1. Open isolated branch from exact observed main using permitted GitHub writer, after checking #639 lane claim and conflicting active owners; protected `main` direct writes forbidden.
2. Apply candidate, run pnpm Prettier, lint, typecheck, focused tests; require full `pnpm quality` plus protected PR Quality/Autonomy/Security/Dependency/CodeQL and review, no skipped proof treated as PASS.
3. Cross-check PostgresWorkflowStore transactionally under multi-process contention, duplicate input, stale claims, expiration, disconnection and ownership/authorization revalidation. Validate no side-effecting/financial capability can enter the READ-only path.
4. Merge through canonical #640 reservation, reconciliation readback in #639–#642 on the **new** main SHA. GitHub merge is not runtime promotion.
5. Separately authorize change to existing AG-01 service if desired, with production identity, flag OFF/ON canary, Core runtime-bound READ-only proving real audit/readback without financial/provider writes, health and rollback. Any current GCP permissions or health blockers remain separate.

**Evidence freshness:** This design document is not a source of current PR/CI/merge status; use GitHub PR #1051, Control Plane #639–#642 and current exact-HEAD checks. As of this integration work, the lane is owned by TOCA_AGENTE_17 with its exclusive lock HELD, the PR is tracked as a repository-only candidate, and actual production/runtime specialist executions remain NOT_PROVEN. No production action, paid operation, ChatGPT task modification, new scheduler or provider call is authorized by this change.

## Recovery correction (source-only candidate, 2026-10-21)

Base: `2fa462d1a43a6c011c5e192496106ae956ced5e8`. Lane:
`AG01-SPECIALIST-BRIDGE-RECOVERY-20261021`, under the existing specialist
WorkflowStore lock. Historical integration statements above are not current lane
or deployment status.

- Expiry limits new mission creation and READY claims. An exact immutable replay
  may locate an expired mission; DONE recovery is authorized again using the
  current identity, persisted payload, target-account inspection, route capability
  membership and specialist owner membership. RUNNING remains pending; expired
  READY cannot execute. A changed payload, scope or expiry is not a replay.
- The checkpoint persists its current step's `executionPath` before invocation.
  Turning the existing flag OFF prevents new specialist selection, but production
  retains the same coordinator for existing SPECIALIST reconciliation. It never
  substitutes direct Core for a persisted specialist path. No new flag, scheduler
  or persistence schema is introduced.
- Legacy attempted checkpoints without a path query the existing deterministic
  WorkflowStore mission. If the branch cannot be proven, recovery stops for human
  review rather than risking a second execution. No reclaim or lease takeover is
  implemented. Missing coordinator/storage and changed authorization fail closed.
- A timeout does not cancel the Core promise. The checkpoint remains RUNNING and
  can reconcile the same claim or later DONE. Polling does not consume additional
  tool attempts or open the failure circuit. Other specialist failures require
  review rather than retrying a workflow whose single attempt may be terminal.
  A process loss with an unresolved RUNNING claim can therefore remain pending;
  this patch does not invent provider reconciliation evidence.
- Core READ's default `providerReadbackVerified=true` is not provider proof.
  Coordinator outputs, including replayed legacy results, expose false and do not
  expose the old `ag01:provider-readback-verified` evidence label. DONE proves the
  persisted Core execution ACK, not an independent provider readback. Global Core
  semantics and side-effecting paths are unchanged. Generic WorkflowStore snapshots
  remain raw historical records; this correction does not rewrite their legacy ACK
  flags or evidence labels. They must not be interpreted as independent provider proof.

These fixes do not connect the 20 external scheduled tasks. Their invocation and
ACK contract remains **NOT_INTEGRATED** until authoritative task IDs, triggers,
executor mapping and a supported invocation/status/ACK interface are established.
In-memory/fake-provider regressions are source evidence only. Exact-HEAD CI,
independent review, protected integration and separately authorized real Postgres
contention/restart proof remain required. No provider, SQL, service, credential,
deployment or external schedule is changed by these tests.
