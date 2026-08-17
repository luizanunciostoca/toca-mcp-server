# Local Quality / CI Verification

Status: **REPRODUCIBLE CONTRACT READY; execution result must be reported as `LOCAL_VERIFIED`, never `CI_VERIFIED`, until GitHub Actions executes the same head.**

## Runtime contract

The local and hosted paths use the same repository commands and versions:

- Node.js: `24.x`;
- pnpm: `10.15.0`;
- PostgreSQL: `18`;
- dependency install: `pnpm install --frozen-lockfile`.

`pnpm quality` fails closed if Node is not `24.x` or pnpm is not exactly `10.15.0`.
`pnpm postgres:e2e` uses PostgreSQL 18 and rejects non-local database hosts unless `TOCA_POSTGRES_E2E_ALLOW_EXTERNAL=1` is explicitly set.

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

1. PostgreSQL 18 startup when `DATABASE_URL` is not supplied;
2. real repository migrations;
3. exact migration-state verification against `schema_migrations`;
4. M-FOUND-12 and R29 PostgreSQL E2E tests;
5. migrations a second time;
6. exact migration-state verification again;
7. isolated container cleanup when the command created the database.

Any non-zero subprocess exit code, unsafe database host, missing runtime dependency, migration mismatch, test failure, or cleanup failure fails the command.

## One-command local verification

From a clean checkout:

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm verify:local
```

The command installs with the frozen lockfile, checks permanent workflow supply-chain policy, runs all Quality gates, runs PostgreSQL E2E, and stores evidence under `.artifacts/local-verification/<timestamp>/`.

A successful run emits:

```text
TOCA_VERIFICATION_STATUS=LOCAL_VERIFIED
```

A failed run emits `TOCA_VERIFICATION_STATUS=FAILED` and exits non-zero. It must never be relabeled as `CI_VERIFIED`.

## Container verification

Docker Compose provides the same contract with an isolated PostgreSQL 18 service:

```bash
docker compose -f docker-compose.quality.yml up \
  --build \
  --abort-on-container-exit \
  --exit-code-from verifier
```

The verifier container runs `pnpm verify:local`; Compose only supplies the isolated PostgreSQL service and network.

## GitHub Actions relationship

`.github/workflows/quality.yml` is an orchestrator: checkout, version setup, supply-chain check, frozen install, then `pnpm quality`.

`.github/workflows/m-found-12-postgres-e2e.yml` is also an orchestrator: checkout, version setup, frozen install, PostgreSQL service, then `pnpm postgres:e2e`.

The executable gate logic lives in repository scripts rather than duplicated YAML. GitHub Actions remains the hosted attestation layer, not the implementation of the gates.
