# R29 production verification provenance

The VIDEO/R29 production promotion must be bound to a successful production deploy that was triggered by a `main` push.

This file intentionally lives under `scripts/**`, which is already part of the canonical production deploy path filter. Changes that close or strengthen the R29 production verifier therefore force a fresh immutable-image deploy of the resulting `main` SHA before the `R29 Production Runtime Verification` workflow can promote VIDEO/R29.

The promotion gate remains fail-closed: runtime proof, durable PostgreSQL readback, verifier-owned outbox drain, temporary-job cleanup, post-cleanup runtime verification, and post-cleanup full Quality must all pass before `PRODUCTION_VERIFIED` is emitted.
