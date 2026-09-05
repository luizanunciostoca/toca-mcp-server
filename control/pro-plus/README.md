# TOCA OS — PRO+ v2 Control Plane

Canonical Drive protocol: `TOCA_OS — ORQUESTRACAO_DE_DESENVOLVIMENTO_PARALELO_GITHUB_COPILOT_PRO_PLUS_v2.0`, Drive ID `17DLQXnLkhVRfN2ina4WDcE-fjQL6AHqH2x6UzhXZxUw`.

PRO+ v2 separates the control plane into two layers so routine orchestration does not create `main` SHA churn.

## Spec plane — repository

The files in this directory are stable policy/specification. Changes require normal PR/CI/merge acceptance.

- `control-plane.schema.json`: enums, identifiers and record contracts.
- `hotspot-policy.json`: globally serialized resources and lock rules.
- `build-broker-policy.json`: main-stability and exact artifact-reuse rules.
- `promotion-materialization-policy.json`: on-demand promotion strategy.
- `metrics-policy.json`: throughput/rework metrics.
- `state-plane.json`: immutable pointers to the mutable state issues.

## State plane — GitHub issues

Routine state changes happen in owner-authored issues and therefore do **not** change `main`:

- #639 — Lane Registry & Hotspot Locks.
- #640 — Integration Queue & Main Stability.
- #641 — Evidence Ledger.
- #642 — Backlog Classification.

Only the Control Tower or an explicitly delegated control-plane worker may mutate those issues. They grant no provider, deployment, database or external-write authority.

## Operational sequence

`REVALIDATE → CLASSIFY BACKLOG → UPDATE LANE REGISTRY → RESOLVE DAG → ACQUIRE LOCKS → DISPATCH READY LANES → REVIEW → EXACT-HEAD CI → INTEGRATION QUEUE → FREEZE → MERGE RESERVATION → MERGE → POST-MERGE ACCEPTANCE → RECOMPUTE MAIN STABILITY → BUILD BROKER → SHA-BOUND EVIDENCE → RELEASE NEXT LANES`.

## Core invariant

Maximize useful parallel throughput, not agent count. Expensive SHA-bound builds/evidence must wait for `MAIN_STABILITY=PASS`. Evidence from an old SHA is stale unless exact tree/runtime-contract equivalence is explicitly proven by the Build Broker policy.
