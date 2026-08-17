# Local Quality / CI Verification

Status: **REPRODUCIBLE CONTRACT READY; execution result must be reported as `LOCAL_VERIFIED`, never `CI_VERIFIED`, until GitHub Actions executes the same head.**

## Runtime contract

The local and hosted paths use the same repository commands and versions:

- Node.js: `24.x`;
- pnpm: `10.15.0`;
- PostgreSQL: `18`;
- Git: required for exact source-tree attestation;
- dependency install: `pnpm install --frozen-lockfile`.

`pnpm quality` fails closed if Node is not `24.x` or pnpm is not exactly `10.15.0`.
`pnpm postgres:e2e` uses PostgreSQL 18 and rejects non-local database hosts unless `TOCA_POSTGRES_E2E_ALLOW_EXTERNAL=1` is explicitly set.
`pnpm verify:local` requires a Git checkout with a clean working tree and an exact 40-character source commit SHA. When `TOCA_SOURCE_SHA` or `GITHUB_SHA` is supplied, it must match the checkout `HEAD` exactly.

## Canonical commands

```bash
pnpm workflow:supply-chain
pnpm quality
pnpm postgres:e2e
pnpm verify:local
```

`pnpm quality` executes, in order:

```text
FORMAT
→ ARCHITECTURE
→ LINT
→ TYPECHECK
→ TEST
→ BUILD
```

`pnpm postgres:e2e` executes:

1. discovers every repository test matching `test/*-postgres-e2e.test.ts`;
2. fails closed if no PostgreSQL E2E suite is present;
3. starts PostgreSQL 18 when `DATABASE_URL` is not supplied;
4. validates the database protocol/host boundary before destructive test setup;
5. applies real repository migrations;
6. verifies exact migration state against `schema_migrations`;
7. executes every discovered PostgreSQL E2E suite in one Vitest invocation;
8. applies migrations a second time;
9. verifies exact migration state again;
10. removes the isolated container when the command created the database.

This discovery model prevents new Foundation/R29 PostgreSQL E2E coverage from being silently omitted from the canonical local/hosted contract. In particular, when `test/foundation-worker-postgres-e2e.test.ts` from the Foundation restart-safety closeout is present on the integrated head, it is automatically included without another CI-script change.

Any non-zero subprocess exit code, unsafe database protocol/host, missing runtime dependency, missing PostgreSQL E2E suites, migration mismatch, test failure, cleanup failure, dirty source tree, or source-SHA mismatch fails the command.

## One-command local verification

From a clean Git checkout:

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm verify:local
```

The command first proves the exact clean Git `HEAD`, installs with the frozen lockfile, checks every versioned workflow against supply-chain policy, runs all Quality gates, runs PostgreSQL E2E, and stores evidence under `.artifacts/local-verification/<timestamp>/`. PostgreSQL substeps are also stored under the verification evidence directory.

A successful run emits the exact source SHA, clean-tree attestation and status:

```text
TOCA_VERIFICATION_SOURCE_SHA=<40-character commit SHA>
TOCA_VERIFICATION_SOURCE_TREE=CLEAN
TOCA_VERIFICATION_STATUS=LOCAL_VERIFIED
```

A failed run emits `TOCA_VERIFICATION_STATUS=FAILED` and exits non-zero. It must never be relabeled as `CI_VERIFIED`.

## Container verification

Docker Compose provides the same contract with an isolated PostgreSQL 18 service. The quality image includes Git, while Compose mounts only the checkout `.git` metadata read-only so the verifier can prove that the copied source tree is clean and exactly matches the requested commit.

Bind the container run to the exact host checkout SHA:

```bash
TOCA_SOURCE_SHA="$(git rev-parse HEAD)" \
  docker compose -f docker-compose.quality.yml up \
  --build \
  --abort-on-container-exit \
  --exit-code-from verifier
```

Compose refuses to start the verifier when `TOCA_SOURCE_SHA` is absent. The verifier independently checks the mounted Git metadata, rejects a dirty source tree and requires the supplied SHA to equal `HEAD` before it can report `LOCAL_VERIFIED`.

The verifier container runs `pnpm verify:local`; Compose only supplies the isolated PostgreSQL service, network, read-only Git metadata and persisted evidence directory.

## GitHub Actions relationship

`.github/workflows/quality.yml` is an orchestrator: checkout, version setup, supply-chain check, frozen install, then `pnpm quality`.

`.github/workflows/m-found-12-postgres-e2e.yml` is also an orchestrator: checkout, version setup, frozen install, PostgreSQL service, then `pnpm postgres:e2e`. It is a permanent gate for `main`, relevant pull-request/runtime paths and manual dispatch; it no longer depends on the historical M-FOUND-12 feature branch. Its test path filter is generic so future `*-postgres-e2e.test.ts` suites participate automatically.

`.github/workflows/m-found-12-provider-read.yml` remains available as an explicit manual provider-READ validation workflow. Its historical feature-branch push/PR triggers are intentionally removed rather than preserving a one-shot milestone workflow as an automatic repository gate.

The executable gate logic lives in repository scripts rather than duplicated YAML. GitHub Actions remains the hosted attestation layer, not the implementation of the gates.
