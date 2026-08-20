# TOCA OS V1 — Canonical Final State — 2026-08-20

Status: **PRODUCTION_VERIFIED**

This document supersedes the release-state snapshot in `docs/operations/v1-canonical-state-2026-08-17.md` for current V1 truth. The older file remains historical evidence for the pre-migration / pre-final-closeout state.

## Canonical repository

- Repository: `luizanunciostoca/toca-mcp-server`
- V1 release SHA deployed and production-verified: `abfb09b17e90c83790e803dcda091c8142c7407f`
- GitHub `main` hosted readback: `protected=true`
- WIF new-repository trust: verified

## V1 code / CI truth

The V1 release includes and has exact-head evidence for:

- governed Foundation/Core path;
- Instagram managed scheduler and direct-publication Core integration;
- PostgreSQL durable restart/retry/dead-letter safety;
- transactional outbox / audit safety;
- permanent PostgreSQL E2E coverage for scheduler/worker persistence paths;
- normal repository Quality Gate: format, architecture, lint, typecheck, tests and build.

## Production runtime

Exact image:

`southamerica-east1-docker.pkg.dev/toca-mcp-production/toca-mcp/server:toca-managed-daemon-abfb09b17e90c83790e803dcda091c8142c7407f`

Verified production revisions:

- `toca-managed-instagram-daemon-00059-wnh`
- `toca-mcp-production-00062-rmc`

Runtime safety boundaries were read back and verified after deployment.

## Scheduler

`toca-managed-instagram-tick` is verified:

- `ENABLED`
- `* * * * *`
- `America/Bahia`
- `POST`

## Cloud SQL / DR

`toca-mcp-db` is verified:

- `RUNNABLE`
- PostgreSQL 18
- deletion protection enabled
- automated backups enabled
- PITR enabled
- retained backups >= 7
- transaction log retention >= 7 days
- final current recovery lag: 128 seconds

Historical isolated restore / PITR / RPO / RTO production evidence remains valid and was not unnecessarily repeated.

## Meta Ads V1 boundary

Production-verified controlled path remains:

`READ -> PREPARE -> CREATE_PAUSED -> independent READBACK`

No activation is implied by V1 verification.

## Instagram safety statement

No Instagram publication was executed solely to prove deployment or closeout.

## Explicit post-V1 scope

Not part of V1 completion:

- real Google Ads provider execution;
- real WhatsApp provider execution;
- real Email provider execution;
- Creative Truth / Venue Fidelity next-phase implementation;
- Demand Intelligence next-phase implementation;
- Photo-to-Video next-phase implementation;
- broader AG-01 external runtime and advanced CRM/Sales expansion.

These items require their own future promotion gates and do not reduce V1 status.

## Evidence anchors

- `docs/operations/v1-final-closeout-2026-08-20.md`
- `docs/operations/v1-new-repo-admin-closeout-2026-08-19.md`
- final runtime redeploy run `32325385858`
- final hosted production readback run `32325385886`
- final sanitized readback artifact `9393447493`
- final hosted gate: `V1_FINAL_HOSTED_READBACK=PASS`

## Final classification

**TOCA OS V1 = PRODUCTION_VERIFIED**
