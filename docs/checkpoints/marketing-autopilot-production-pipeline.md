# Marketing Autopilot publication pipeline — GCP governed scheduler

Status: **RESTORED AS FAIL-CLOSED SCHEDULER INFRASTRUCTURE**.

The scheduled Instagram publication lane uses the same hardened GCP execution boundary as `Marketing Publish Now`; it does not restore the old mutable-tag PREPARE/PUBLISH workflow and it does not re-enable the GitHub-native writer.

## Canonical flow

`TOCA OS Content Registry approval → protected queue snapshot → due-window controller → exact audited code SHA → GCP WIF → immutable Artifact Registry digests → Cloud Run preparation/execution → Secret Manager → Meta provider → provider readback → write-disable verification → evidence`.

Canonical files:

- `.github/workflows/marketing-autopilot-publication.yml`;
- `control/gcp-instagram-publication-queue.json`;
- `scripts/marketing-scheduled-publication-controller.mjs`;
- `scripts/marketing-publish-now.sh`;
- `scripts/marketing-publish-now-fixed.sh`;
- `docs/deployment/gcp.md`.

GitHub-native publication remains SHADOW/reference only.

## Queue authority

The scheduler consumes only `control/gcp-instagram-publication-queue.json` from protected `main`. The queue is versioned, bounded to `America/Bahia`, and fail closed.

A queue item must bind all of these facts before it can become due:

- `status=SCHEDULED` and `scheduledState=SCHEDULED`;
- explicit approval with `approvalStatus=APPROVED`;
- `publicationStatus=NOT_PUBLISHED`;
- exact Instagram account;
- exact master Drive file ID;
- exact JPEG SHA-256;
- exact approved caption SHA-256;
- Creative Truth policy/standard/creative IDs and PASSED gates;
- rights clearance bound to the same asset SHA;
- Content Registry source, sheet, row, approval state, publication state, asset SHA and caption SHA;
- stable correlation and idempotency keys;
- exact audited code SHA that is an ancestor of the protected-main queue snapshot.

`CANARY` mode accepts at most one item. `LIMITED` may contain multiple future items, but a cycle fails closed if more than one item is simultaneously due.

## Time boundary

The workflow polls every 15 minutes. Polling alone never grants write authority.

The controller will not generate a provider command before `scheduledAt`. Once due, the item has a maximum 30-minute execution window. A missed item outside that window fails closed and requires reconciliation/re-approval rather than being published late automatically.

The generated command receives a fresh `issuedAt` only at runtime. Its approved caption, asset, rights, Creative Truth binding, scheduled time, idempotency identity and target code SHA come unchanged from the protected queue snapshot.

## Shared hardened writer

Scheduled execution calls `scripts/marketing-publish-now-fixed.sh` with `PUBLICATION_POLICY_MODE=SCHEDULED` and an ephemeral command file in `/tmp`.

The FAST_PATH and SCHEDULED policies share the same provider execution machinery but retain different content-policy boundaries:

- FAST_PATH keeps its CTA and five-hashtag requirements;
- SCHEDULED preserves the exact caption already approved in the Content Registry and does not manufacture CTA/hashtag changes at publication time.

Scheduled mode additionally requires `schedulingPolicy=SCHEDULED_GCP`, refuses early execution and refuses execution after the configured maximum delay.

## Provider safety

A due item authenticates through short-lived GCP WIF only after queue/controller validation passes. The execution tree is then detached to the item’s pinned audited SHA.

The shared writer must still prove:

- exact Drive asset hash;
- immutable application and preparation image digests;
- pinned database secret version;
- Creative Truth asset binding;
- exact approved request SHA;
- one write-scoped Cloud Run execution;
- immediate write disable;
- independent provider readback;
- final verification that write capability is disabled.

An uncertain publish response, failed disable, failed readback or failed final disable verification produces `RECONCILIATION_REQUIRED` and must not be converted into an automatic retry that could duplicate provider state.

## Rollout

Scheduler infrastructure is merged separately from any live item. Its canonical queue is initially `enabled=false` with no items.

The first live CANARY is introduced only in a second protected-main change after the scheduler merge SHA is known, so `targetCodeSha` can be pinned to the exact audited scheduler/writer implementation. The Content Registry scheduled time is preserved; no canary may be published early merely to test infrastructure.

The system may be promoted from CANARY to LIMITED only after one live scheduled publication returns a durable Meta media identity, provider readback matches the exact request, evidence is retained, write capability is proven disabled, and an independent reconciliation confirms no duplicate side effect.
