---
applyTo: 'control/pro-plus/**,scripts/check-pro-plus-v2-control-plane.mjs,AGENTS.md,.github/copilot-instructions.md,.github/agents/toca-*.agent.md,.github/prompts/*.prompt.md,.github/workflows/instagram-engagement-shadow-runtime-build.yml'
---

# PRO+ v2 control-plane invariants

Repository files are the stable **spec plane**. Mutable lane, lock, queue, stability, evidence and backlog state lives only in owner-authored issues #639–#642 unless the architecture is explicitly revised.

Do not commit routine lane-state changes to `main`. Do not add a second mutable registry in the repository.

Any change to PRO+ v2 spec, Main Stability enforcement or Build Broker policy requires exact-head CI. Production/provider authority remains separate.

A stability PASS is valid only for its exact evaluated main SHA and with no merge reservation. Artifact reuse requires exact tree + runtime-contract equivalence.
