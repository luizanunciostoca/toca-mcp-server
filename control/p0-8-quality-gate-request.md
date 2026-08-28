# P0.8 Exact-Head Quality Gate Request

Canonical snapshot under test: `b1d838a6b3efe35b7df3afb6b53c4a9b42f7712a`.

The branch workflow `.github/workflows/p0-8-exact-head-quality-gate.yml` must checkout that exact SHA, verify `git rev-parse HEAD`, and execute formatting, architecture/governance, lint, typecheck, tests, build, and dependency audit.

This file exists only to create an auditable push event for the dedicated validation branch. It does not alter the canonical snapshot under test.
