# GitHub-native publication queue synchronization

## Purpose

Keep Google Drive / TOCA OS as the editorial authority while allowing the GitHub-native publisher to operate without Google Cloud runtime infrastructure.

The queue is **not** an approval system. It is a protected execution mirror.

## Authority flow

`TOCA OS Content Registry → trusted registry snapshot → queue compiler → protected queue PR → main → verified asset staging → GitHub scheduler → Meta provider`

Only items already authorized by TOCA OS may enter `control/github-native-publication-queue.json`.

## Queue sync compiler

The fail-closed compiler lives at:

`src/github-native-publication/github-native-publication-queue-sync.ts`

It does not fetch or mutate Google Drive. A trusted TOCA OS control-plane session or connector must read the live canonical registry and provide a temporary JSON snapshot. This keeps private Drive access outside GitHub Actions and prevents GitHub from becoming an approval authority.

The CLI reads:

- `TOCA_PUBLICATION_REGISTRY_SNAPSHOT_PATH`, default `control/github-native-publication-registry-snapshot.json`;
- `TOCA_PUBLICATION_QUEUE_PATH`, default `control/github-native-publication-queue.json`;
- `TOCA_PUBLICATION_QUEUE_SYNC_EVIDENCE_PATH`, default `github-native-publication-queue-sync-evidence.json`.

After the repository is built, run:

```bash
node dist/src/github-native-publication/github-native-publication-queue-sync.js
```

The snapshot must identify the canonical spreadsheet ID and `CONTENT_ITEMS` sheet, include an explicit-offset `fetchedAt`, and be no more than 15 minutes old. A timestamp more than five minutes in the future is rejected as clock/source ambiguity.

The compiler requires at least 30 minutes of lead time before an item may be mirrored. This protects time for a queue PR, protected-main CI and content-addressed asset staging. Near-due and expired items are skipped rather than replayed.

## Queue sync eligibility

A sync worker may mirror an item only when all of these are true in the canonical registry:

- `channel=INSTAGRAM`;
- `status=PRODUCED`;
- `approval_status=APPROVED`;
- `publication_intent=SCHEDULED`;
- operation is `SUNSET` or `THE_PARTY`;
- format is `FEED` or `STORY`;
- scheduled time is still in the future with the minimum lead time;
- explicit timezone offset is present;
- exact final asset Drive file ID is known;
- final asset SHA-256 is known;
- correlation and idempotency keys are known;
- Creative Truth binding exists with Brand, Venue and Quality gates passed;
- `creativeTruthBinding.outputSha256` exactly equals the final asset SHA-256;
- `exactAssetBinding=TRUE`;
- operation and owner rules still allow the content to run.

Rows that are still `IDEA`, `BRIEFED`, unapproved, unscheduled, unsupported, already due or too close to execution are recorded as `SKIPPED` in sync evidence and never promoted by the compiler.

An item that otherwise declares itself eligible but lacks its exact asset, identity, idempotency or Creative Truth evidence causes the compilation to fail closed. The existing queue file is not rewritten because output is written only after successful compilation.

The sync worker must never convert pending content into approved content and must never backfill an expired slot.

## Protected-main rule

The sync worker must update the queue through a dedicated branch and pull request. Direct queue writes to protected `main` are prohibited.

Before merge it must require the normal protected-main gates. Any unresolved review, failed gate, stale base, ambiguous canonical state, or changed asset binding fails closed.

## Asset binding

Each mirrored item carries:

- the content-addressed `raw.githubusercontent.com` publication URL;
- exact `asset.sha256`;
- exact `creativeTruthBinding.outputSha256`;
- `asset.sourceDriveFileId` for staging provenance;
- canonical registry spreadsheet, sheet and row reference.

The raw GitHub publication URL is deterministic from the approved SHA-256. It may be written to the queue before the bytes are staged because the publisher cannot use the asset unless the exact hash-addressed object exists.

## Automatic staging after queue merge

A merge that changes `control/github-native-publication-queue.json` triggers `github-native-instagram-auto-stage-assets.yml` on protected `main`.

The workflow:

1. checks out the exact merged controller SHA;
2. reads the protected queue;
3. downloads the public Drive source using only the canonical `sourceDriveFileId`;
4. accepts only HTTPS Google Drive / Google user-content final hosts;
5. enforces a bounded asset size;
6. verifies JPEG magic bytes;
7. verifies exact SHA-256 against both the queue asset hash and Creative Truth;
8. writes only the content-addressed JPEG and manifest to `publication-assets`;
9. emits immutable staging evidence;
10. commits nothing if any required asset blocks.

No Meta token and no Google credential are exposed to this staging workflow.

## Scheduler behavior

The publication scheduler remains independent from queue production. It wakes every five minutes and publishes only items inside the ±5 minute window. Missing or unstaged assets block; missed slots are not replayed.

## Operational sync cadence

The TOCA OS queue-sync task should revalidate the live Content Registry at least hourly and mirror approved future items with enough lead time for protected CI and asset staging.

If no eligible future item exists, the correct action is no queue mutation.

## Rollout boundary

Queue synchronization and asset staging may operate while publication mode remains `SHADOW` and writes remain disabled. Real provider writes require the separate CANARY authorization and Meta secret/configuration described in `github-native-instagram-publication.md`.
