# P0.8 Exact-Head Quality Gate Evidence

Canonical snapshot validated: `b1d838a6b3efe35b7df3afb6b53c4a9b42f7712a`.

GitHub Actions run: `33145521785`
Result: `success`
Completed: `2026-08-28T05:42:45Z`

The dedicated workflow checked out the exact canonical SHA and verified `git rev-parse HEAD` before executing the gates.

Validated successfully:
- dependency installation with frozen lockfile;
- format check;
- architecture and governance checks;
- lint;
- typecheck;
- tests;
- build;
- dependency audit at `high` severity threshold.

This branch exists only to hold reproducible Quality Gate evidence. The canonical snapshot itself was not modified by the validation run.

Evidence run URL: https://github.com/luizanunciostoca/toca-mcp-server/actions/runs/33145521785
