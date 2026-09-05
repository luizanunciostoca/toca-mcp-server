# TOCA OS repository instructions for GitHub Copilot

Follow the root `AGENTS.md` as the standing development contract.

For every coding task:
- revalidate live `main` and record the exact base SHA before editing;
- use the issue/task as the scope boundary;
- search current PRs/branches for competing or reusable work;
- work on one isolated branch/worktree and one lane only;
- respect declared file ownership and shared-hotspot locks;
- do not expand scope silently;
- write focused regression tests for behavior changes;
- prefer the smallest compatible fix over broad refactoring;
- do not create duplicate execution/control-plane components;
- never hardcode secrets or real tokens;
- do not run external provider writes to prove code works unless a separate governed production authorization explicitly permits it;
- do not push or merge directly to `main`;
- treat CI/acceptance as exact-SHA evidence and rerun after HEAD changes.

When a task touches a migration, shared contract, lockfile, workflow, policy/approval boundary, provider interface, or production controller, treat that path as lock-required and verify no concurrent lane owns it.

When finished, provide a structured handoff with BASE_SHA, HEAD_SHA, changed files, test evidence, risks, blockers, dependencies, and next integration action.
