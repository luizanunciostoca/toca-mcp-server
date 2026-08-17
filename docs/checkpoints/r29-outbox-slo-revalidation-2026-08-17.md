# Video / R29, transactional outbox and SLO revalidation — 2026-08-17

## Scope

This checkpoint revalidates only Video / R29, the transactional outbox, stalled-event closure and the related SLO. It does not add a product feature, provider, public MCP tool, route or publication side effect.

GitHub Actions is not treated as a current verification dependency in this checkpoint. Historical run artifacts and logs are used only as immutable evidence of provider-backed execution already completed on the unchanged runtime code.

## Revalidated repository state

Current `main` at final revalidation:

- SHA: `3f6acac12474785b1212c1a9647e473d4d92dd92`;
- tree: `7333895cd1d8c095255c6af3a63cc1483fb81f52`.

The final post-R29 ratification repository SHA was `90d23d83ed53b1c9e8f73c14409d1329b1826f14`, with deployed runtime SHA `ac0ba469a57f12c801148b5821e14e34fd86d281`.

A direct Git compare from `90d23d83ed53b1c9e8f73c14409d1329b1826f14` to current `main` shows documentation/governance changes plus supply-chain maintenance in `scripts/check-workflow-supply-chain.mjs` and `.github/dependabot.yml`. No R29 runtime, R29 migration, transactional-outbox runtime, R29 persistence, scheduler runtime or R29 SLO implementation file changed after the ratified source state.

## R29 branch / PR reconciliation

The relevant historical implementation heads are superseded by `main`:

- `feat/r29-production-runtime-verification-final`: behind `main`, ahead by 0 at the original reconciliation;
- `feat/r29-video-reconciliation-final`: behind `main`, ahead by 0 at the original reconciliation;
- `fix/r29-validation-outbox-drain`: divergent history, but the canonical drain script blob in the branch is identical to `main`;
- `fix/r29-post-cleanup-proof-final`: divergent history, but the canonical post-cleanup verifier blob in the branch is identical to `main`;
- `feat/r20-r29-video-content-repurposing-final` / PR #114: closed without merge and superseded by the current-architecture reconciliation.

Canonical merged chain includes PR #143, #157 and #162. No open R29 implementation PR remained at the original revalidation; this documentation closeout is PR #189.

These historical heads must not be merged back into `main`.

## Migration and durable runtime proof

The canonical R29 migrations remain:

- `020_content_item_versioning_video.sql`;
- `021_r29_video_artifacts.sql`.

The final provider-backed post-cleanup verifier on runtime SHA `ac0ba469a57f12c801148b5821e14e34fd86d281` read `schema_migrations` and verified exactly those two R29 migrations.

The same execution proved:

- one persisted R29 video artifact;
- provider readback verified;
- R29 channel-adaptation readback verified;
- durable content readback verified after a PostgreSQL pool/runtime restart;
- Audit Ledger readback verified;
- fail-closed behavior verified when the runtime binding is unavailable;
- no external publication executed.

## Transactional outbox and stalled events

The original stalled assessment identified 14 pending rows. The rows were classified by direct PostgreSQL evidence as R29 verifier/test residue rather than business events. The cleanup transitioned only the pre-classified verifier event IDs through durable delivery state; it did not delete or force-complete business data.

PR #157 then changed the permanent verifier path so cleanup is scoped by exact R29 verification evidence and fails closed on unexpected count, type, tenant, correlation, status or attempt state.

The final canonical R29 execution created three fresh verifier-owned events and produced:

- matched: 3;
- drained: 3;
- delivered: 3;
- pending: 0;
- external publication executed: false.

The post-cleanup verifier independently re-read the same evidence and required `outboxMatched=3`, `outboxDelivered=3` and `outboxPending=0`.

## SLO proof

The authoritative post-R29 Foundation/SLO artifact is artifact `9261408650` from assessment run `31938670357`.

Its archive digest was independently rechecked during this revalidation and matches the recorded value:

`sha256:b1c4ceb6da7bb0eb3a49e260296ff3bc870635ffa357eea0daae3ac43e7da819`

The JSON evidence inside that artifact records, at `2026-08-16T09:19:18.020Z`:

- `outboxPending=0`;
- `oldestOutboxAgeSeconds=0`;
- no pending outbox rows;
- `alerts=[]`;
- `healthy=true`;
- Audit Ledger integrity valid;
- Core availability `1.000` against target `0.999`;
- scheduler success `1.000` against target `0.995`.

The runtime SLO objective remains a maximum oldest active-outbox age of 300 seconds. The daily-control implementation evaluates active `PENDING`, `CLAIMED` and `FAILED_RETRYABLE` rows and raises the stalled classification only when at least one active row exceeds that objective.

## PostgreSQL test coverage

The repository already contains isolated PostgreSQL coverage for the relevant semantics:

- R29 video PostgreSQL E2E exercises artifact persistence, deterministic retry, channel adaptation and durable readback after reconnect;
- M-FOUND-12 PostgreSQL E2E exercises outbox durability, retry and delivery after restart;
- transactional-outbox tests cover transport-evidence ordering and retry behavior;
- PostgreSQL contract tests cover `FOR UPDATE SKIP LOCKED`, stale-claim recovery and retry/dead-letter transitions.

The current execution environment used for this 2026-08-17 revalidation did not expose a repository checkout, PostgreSQL service, GCP credentials or package-registry connectivity. Therefore no new local `pnpm` run or new live Cloud SQL sample is claimed here.

## Classification

Based on current source equivalence plus preserved real provider evidence:

- Video / R29: **CODE_COMPLETE** and **PROVIDER_VERIFIED**;
- R29 durable PostgreSQL readback / restart / fail-closed: **CODE_COMPLETE** and **PROVIDER_VERIFIED**;
- verifier-owned outbox drain: **CODE_COMPLETE** and **PROVIDER_VERIFIED**;
- historical stalled-event incident: **CLOSED** by direct classification and bounded delivery transition;
- SLO closure evidence: **PROVIDER_VERIFIED** at the authoritative 2026-08-16 assessment point;
- current `main` exact-head local quality: **NOT RE-CLAIMED** in this checkpoint;
- current `main` exact-head CI: **NOT CI_VERIFIED**.

No new runtime fix is justified by the evidence reviewed here. Any later point-in-time SLO recertification should perform a fresh read-only production assessment; it must not reopen or mutate historical R29 rows unless a new classified violation actually exists.
