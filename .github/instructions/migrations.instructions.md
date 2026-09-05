---
applyTo: 'migrations/**,**/migrations/**'
---

# Migration lane rules

Migrations are globally serialized resources.

Before creating or renumbering a migration:

1. inspect live `main` and all open migration-related PRs;
2. confirm an explicit migration slot/number is assigned to this lane;
3. verify dependency order and schema compatibility;
4. avoid editing another lane's migration;
5. run the repository's PostgreSQL/migration E2E checks when available.

A collision or renumbering changes the candidate HEAD and invalidates previous acceptance evidence. Never merge a migration based on CI for a prior numbering/head.

Do not combine unrelated schema cleanup with the assigned migration.
