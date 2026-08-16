# Final Production Provenance — 2026-08-16

This marker exists only to bind the final TOCA OS V1 certification to a `main` push that is inside the permanent production deploy workflow path set (`scripts/**`).

The resulting `main` SHA must be the literal immutable image/deployed SHA before final certification. The deploy completion must trigger the hardened R29 `workflow_run` gate, including verifier-owned outbox drain, temporary-job cleanup readback, post-cleanup validation and post-cleanup Quality.

No product capability, domain, provider, public MCP tool, scheduler, migration or runtime behavior is introduced by this marker.
