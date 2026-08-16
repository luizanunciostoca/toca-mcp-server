# Cloud SQL DR — provider revalidation 2026-08-16

Status: **BLOCKED_IAM — restore drill not executed**

This evidence record is intentionally narrow. It does not claim a tested restore, measured RPO/RTO, or `PRODUCTION_VERIFIED` DR while the current approved identities cannot create, restore and delete an isolated Cloud SQL drill target.

## Repository baseline

- repository: `luizidebook/toca-mcp-server`
- source branch: `main`
- source SHA: `0ffc2cf11c1f48894976676265ea3ebf3792ae87`
- official CI workflow: `Quality Gate` (`.github/workflows/quality.yml`)

## Production Cloud SQL readback

Fresh read-only provider revalidation reused the existing reliability readback workflow. No Cloud SQL mutation was attempted.

Production target:

- project: `toca-mcp-production`
- instance: `toca-mcp-db`
- configured region: `southamerica-east1`
- engine/version: PostgreSQL 18 (`POSTGRES_18`)
- state: `RUNNABLE`
- deletion protection: enabled
- automated backups: enabled
- PITR: enabled

Fresh provider evidence:

- workflow run: `31914009163`
- fresh job: `95112848317`
- verified at: `2026-08-16T04:03:59Z`
- latest successful backup end time: `2026-08-15T02:48:39.633Z`
- backup age at verification: `90920` seconds
- configured recovery-readback objective: `129600` seconds (36 hours)
- artifact id: `9257761662`
- artifact digest: `sha256:ead57d20392cf5f8cc74480c00961ebb65f33aff0afbab9db73cb4304a6f5b68`

The existing infrastructure control plane also records and provider-verified the current backup-retention target on run `31852282477`:

- retained automated backups: `7`
- transaction-log retention: `7` days
- automated backups preserved
- PITR preserved

That run completed `CLOUD_SQL_COST_OPTIMIZATION=VERIFIED` after reading back those exact values.

## Current service identities and IAM boundary

Operational identities in the current control plane:

- infrastructure admin: `toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`
- deployer: `toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`
- runtime: `toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`

The runtime identity must not receive DR mutation privileges.

A fresh `projects.testIamPermissions` probe executed with the deployer identity and did not modify any resource.

Granted from the requested DR permission set:

- `cloudsql.backupRuns.get`
- `cloudsql.backupRuns.list`
- `cloudsql.instances.get`

Not granted:

- `cloudsql.instances.create`
- `cloudsql.instances.delete`
- `cloudsql.instances.clone`
- `cloudsql.instances.restoreBackup`

Fresh IAM evidence:

- workflow run: `31914127336`
- fresh job: `95112583488`
- artifact id: `9257732619`
- artifact digest: `sha256:8c780f3462de454a7afcf2f4f0da767a3f7436f98de381358e4b1f4f4cd74646`

A second read-only IAM boundary probe verified that neither approved operational identity can self-grant the missing project permissions:

- infrastructure admin: `resourcemanager.projects.setIamPolicy` not granted
- deployer: `resourcemanager.projects.setIamPolicy` not granted

Evidence:

- workflow run: `31924394406`
- fresh job: `95112650839`
- artifact id: `9257740330`
- artifact digest: `sha256:784582660f75a114fb9bc20280b1910123a368f4170554740c3cc66e70940129`

Therefore no authorized self-service path exists from the current GitHub Workload Identity identities to enable the isolated restore drill.

## Relevant quota gate

Cloud SQL create/resource quota was not independently read back by the existing reliability probe. This remains **NOT_PROVIDER_VERIFIED** rather than inferred. It is not the current execution blocker because `cloudsql.instances.create` is denied before an isolated target can be created. After IAM is granted, quota availability must be checked immediately before target creation and the drill must stop without touching production if quota is insufficient.

## Restore target validation contract

The current repository contains 14 ordered migrations, `001_production_foundation.sql` through `014_privacy_governance.sql`. `scripts/migrate-and-verify.ts` executes migrations and then requires `schema_migrations` to match the repository migration file list exactly.

A successful isolated restore drill must validate at least:

- `schema_migrations` — exact 14-version match after running/verifying current migrations
- Transactional Outbox: `event_outbox`, `event_outbox_delivery_attempts`, `event_consumer_receipts`
- Audit Ledger: `audit_ledger_events`, `audit_ledger_heads`, plus integrity verification and append-only invariants
- EventRecord: `event_records`, `event_record_revisions`, `event_record_external_refs`
- CRM: `crm_contacts`, `crm_contact_channels`, `crm_leads`, `crm_opportunities`, `crm_record_revisions`, `crm_idempotency_keys`
- Privacy: `privacy_ledger_events` and append-only invariants

Basic consistency checks must include row counts/non-negative cardinality, required foreign-key reachability, migration-version equality and integrity checks supplied by repository code. Provider writes remain disabled during the drill.

## Minimum external IAM action

For the preferred backup-to-new-instance drill, the deployer already has `cloudsql.backupRuns.get`. The minimum additional DR mutation permissions are therefore:

- `cloudsql.instances.create`
- `cloudsql.instances.restoreBackup`
- `cloudsql.instances.delete` — cleanup of the isolated drill target only

`cloudsql.instances.clone` is not required for the backup-restore route. Add it only if the approved drill explicitly selects a clone/PITR path that requires it.

An external project IAM administrator should grant a project-level custom role with only the required permissions to the deployer, not to the runtime service account. Do not grant project Owner/Editor merely to close DR.

Example admin commands:

```bash
PROJECT=toca-mcp-production
SA=toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com
ROLE_ID=cloudSqlDrDrillOperator

gcloud iam roles create "$ROLE_ID" \
  --project="$PROJECT" \
  --title="Cloud SQL DR Drill Operator" \
  --description="Temporary least-privilege role for isolated Cloud SQL restore drills" \
  --permissions="cloudsql.instances.create,cloudsql.instances.restoreBackup,cloudsql.instances.delete" \
  --stage=GA

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" \
  --role="projects/$PROJECT/roles/$ROLE_ID"
```

After the drill and isolated-target deletion, revoke the temporary binding:

```bash
gcloud projects remove-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" \
  --role="projects/$PROJECT/roles/$ROLE_ID"
```

If a pre-existing least-privilege custom role already contains exactly the required permissions, reuse it instead of creating a duplicate role.

## Drill state for this revalidation

- selected backup for actual restore: **none — restore was not authorized**
- candidate latest successful backup: `2026-08-15T02:48:39.633Z`
- temporary instance: **not created**
- restore start/end timestamps: **not available**
- measured RPO: **not available; no real restore was executed**
- measured RTO: **not available; no real restore was executed**
- restored connection validation: **not executed**
- migrations on restored target: **not executed**
- `schema_migrations` on restored target: **not executed**
- critical-table validation on restored target: **not executed**
- cleanup: **not applicable because no temporary instance was created**
- production mutation by this revalidation: **none**

Backup freshness, PITR enablement and retention are recovery controls; they are not substitutes for a tested restore.

## Exit condition

DR can move from `BLOCKED_IAM` to `PRODUCTION_VERIFIED` only after all of the following are captured from one real isolated drill:

1. IAM/quota preflight passes;
2. a new temporary Cloud SQL target is created without replacing production;
3. a selected backup/PITR point is restored;
4. connectivity, engine/version and all current migrations are validated;
5. `schema_migrations`, Audit Ledger, Outbox, EventRecord, CRM and Privacy checks pass;
6. real RPO and RTO are measured from recorded timestamps;
7. only the temporary drill instance is deleted;
8. production is read back unchanged;
9. temporary DR IAM privilege is revoked when it is not needed for steady-state operations;
10. provider evidence is retained.

Current truthful classification: **BLOCKED_IAM**.
