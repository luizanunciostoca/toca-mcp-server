# PRO+ v2 machine-readable development control plane

PRO+ v2 keeps stable orchestration policy in the repository and mutable coordination state in owner-authored GitHub issues. This avoids changing `main` merely to record lane progress, which would invalidate exact-SHA runtime and evidence chains.

The canonical policy is the Drive protocol `TOCA_OS — ORQUESTRACAO_DE_DESENVOLVIMENTO_PARALELO_GITHUB_COPILOT_PRO_PLUS_v2.0` (`17DLQXnLkhVRfN2ina4WDcE-fjQL6AHqH2x6UzhXZxUw`).

The repository spec plane lives at `control/pro-plus/`. The mutable state plane is #639–#642. The Integration Queue controls freeze/merge reservation/post-merge acceptance; the Build Broker refuses expensive SHA-bound builds unless #640 is recalculated to `MAIN_STABILITY=PASS` for the exact current main and `MERGE_RESERVATION=NONE`.

Promotion branches should be materialized from current main after prerequisites whenever practical rather than kept alive through repeated main drift.

PRO+ v2 never grants provider-write, deployment, database-mutation, autonomy-promotion or production authority by itself.
