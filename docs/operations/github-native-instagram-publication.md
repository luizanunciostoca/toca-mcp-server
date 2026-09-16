# GitHub-native Instagram publication — shadow/reference lane

## Status

The GitHub-native publication implementation is **not** the canonical TOCA OS Instagram writer. The active production architecture is the governed GCP `publish-now` path documented in `docs/deployment/gcp.md`.

This GitHub-native lane is retained only for read-only comparison, forensic recovery reference, and future architecture evaluation. It must not create Meta publication side effects while GCP is the sole authorized writer.

## Authority boundary

The following controls are mandatory while this lane remains SHADOW:

- `.github/workflows/github-native-instagram-publisher.yml` must not expose the write-capable `github-native-instagram-publish-controlled` repository dispatch;
- routine scheduled execution must remain SHADOW/read-only with writes disabled;
- no GitHub Actions secret is sufficient by itself to authorize publication;
- expired one-time canary window/recovery controllers must remain retired;
- `publication-state` is historical/durable evidence and must never be edited or cleared merely to force a retry;
- there is no automatic fallback from the GCP writer to this lane.

The purpose of these restrictions is to maintain exactly one production writer and avoid duplicate-provider ambiguity.

## Preserved implementation

The GitHub-native implementation can still validate queue/state contracts and compare what it _would_ publish. Its historical design includes:

- content-addressed staged assets;
- Creative Truth SHA binding;
- durable request fingerprints and idempotency keys;
- provider-state reconciliation logic;
- immutable run evidence.

Those capabilities remain useful as shadow diagnostics, but they do not confer provider-write authority.

## Queue contract

`control/github-native-publication-queue.json` remains fail-closed. Existing entries may be inspected for reconciliation/history, but an item in this queue is not an instruction to publish while GCP is canonical.

A durable state record remains authoritative for the GitHub-native lane's own prior attempts. Reusing an existing idempotency key with changed account, media URL, caption, asset hash, correlation or Creative Truth binding remains invalid.

## Historical canary state

The recovery attempt for `MKT-20260917-SUNSET-FEED-0900` never reached the Meta provider through the GitHub-native writer because the provider credential was absent at execution time. Its durable ledger therefore remained `DRAFT`. This historical fact is useful for duplicate auditing but does not authorize a new write.

Before any future architecture decision re-enables GitHub-native writes, provider state must still be reconciled independently; a local `DRAFT` record alone is not proof that no external publication exists from another transport.

## Incident behavior

This lane intentionally prefers no publication over a duplicate or unverified publication. It must remain fail closed when any exact binding, approval, account, asset, idempotency or provider-state condition is uncertain.

## Reactivation requirements

Reactivation as a provider writer would require a new explicit architecture decision and a separate controlled rollout. At minimum it would require:

1. proof that the GCP writer is disabled so there is no dual-writer period;
2. fresh exact approval and provider duplicate audit;
3. protected-main change with Quality, Security and Autonomy gates;
4. single-item CANARY with independent provider readback;
5. durable evidence and subsequent reconciliation.

Until those requirements are intentionally completed, all operational documentation and automation must treat GitHub-native publication as SHADOW only.
