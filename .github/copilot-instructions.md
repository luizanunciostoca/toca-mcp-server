# TOCA OS repository instructions for GitHub Copilot — PRO+ v2

Follow root `AGENTS.md` and `control/pro-plus/README.md`.

Before coding, revalidate live `main`, read the v2 state plane (#639–#642), reconcile competing work, and obtain an isolated Lane Contract. Never write outside owned paths or a lock-required hotspot without Control Tower assignment.

Use #639 for mutable lanes/locks, #640 for Integration Queue/Main Stability, #641 for sanitized evidence validity, and #642 for backlog classification. Routine state changes must not create `main` commits.

For integration, require exact-HEAD CI and the queue lifecycle `FROZEN → CI_RUNNING → MERGE_RESERVED`. After merge, require post-merge acceptance and invalidate old SHA-bound evidence.

Before expensive runtime/build/evidence work, require #640 to contain `MAIN_STABILITY=PASS`, exact current `EVALUATED_MAIN_SHA`, and `MERGE_RESERVATION=NONE`. Do not reuse stale artifacts unless the Build Broker proves exact tree/runtime-contract equivalence.

Prefer on-demand promotion materialization from current main. Never infer provider/production state from code or CI, never manufacture provider evidence, never hardcode secrets, never blind-retry ambiguous writes, and never push/merge directly to `main`.

When finished, provide exact SHA-bound handoff and update only the control-plane state issue you are authorized to own.
