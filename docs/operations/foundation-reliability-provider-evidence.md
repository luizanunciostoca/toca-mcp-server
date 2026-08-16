# Foundation v1 Reliability — Provider Evidence

Status: **CODE/RECOVERY CONTROLS VALIDATED; MONITORING DELIVERY AND CLOUD SQL RESTORE DRILL BLOCKED BY CURRENT IAM**

Baseline repository main for this closeout: `95ce5d72321509a91989f0e76830e5a530e20135`.

This document records executed GCP evidence. It intentionally distinguishes provider state that was actually verified from operations that cannot be performed with the currently approved service identities.

## Cloud SQL recovery controls — verified

GCP readback run `31914009163` executed with Workload Identity Federation and two existing service identities.

The infrastructure-admin identity authenticated successfully but could not read `toca-mcp-db`; the provider returned that the instance was not visible or the identity was not authorized.

The workflow then reauthenticated as `toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`. That identity successfully verified the production Cloud SQL instance and required recovery controls:

- instance `toca-mcp-db` is `RUNNABLE`;
- database version is PostgreSQL 18;
- deletion protection is enabled;
- automated backups are enabled;
- point-in-time recovery is enabled;
- at least one successful backup exists;
- latest successful backup age is within the Foundation objective of 36 hours.

Sanitized evidence artifact from run `31914009163`:

- artifact id: `9254448378`;
- archive digest: `sha256:50989398010a24c17356f641bcb06ebd82e43a27833421981ff35dd1499e26f8`.

Historical infrastructure run `31844320778` independently verified backup/PITR before the completed provider-managed storage shrink, so the current deployer readback is consistent with the existing infrastructure-control history.

## Cloud Monitoring alert transport — IAM blocked

The same run performed read-only REST inventory of Cloud Monitoring notification channels and alert policies.

Results:

- infrastructure-admin notification channels: HTTP 403;
- infrastructure-admin alert policies: HTTP 403;
- deployer notification channels: HTTP 403;
- deployer alert policies: HTTP 403.

Therefore Foundation code can classify P0/P1/P2 incidents and preserve telemetry/evidence, but no current approved GitHub/GCP service identity can inventory, configure or test the managed Cloud Monitoring delivery plane.

No broader Monitoring role is granted by this closeout merely to mark the checklist complete. Alert delivery remains an explicit provider-admin IAM blocker until a separately authorized identity grants the minimum Monitoring permissions and the resulting channel/policies are read back and tested.

### 2026-08-16 telemetry → alert routing → SLO revalidation

Revalidated against production `main@81f6f84df6b725bfc5994c2d1582241b7936c614` using only read-only Cloud Monitoring inventory and `projects.testIamPermissions`.

Current production deployment evidence already proves:

- immutable image deployment from the current main SHA;
- official production migration gate passed with `PRODUCTION_SCHEMA_MIGRATIONS_CURRENT=14`;
- authenticated minute trigger smoke passed;
- Cloud Run runtime and MCP scheduler surface remained fail-closed and scale-to-zero;
- Foundation daily control telemetry and SLO classification code are deployed.

A fresh Monitoring inventory re-run of `31914009163` again returned HTTP 403 for both notification-channel and alert-policy inventory under both existing operations identities.

Read-only IAM probe `31924349410` then tested the infrastructure-administrator identity. `projects.testIamPermissions` returned HTTP 200 with none of the requested permissions granted, including:

- `resourcemanager.projects.setIamPolicy`;
- `monitoring.notificationChannels.list`;
- `monitoring.notificationChannels.create`;
- `monitoring.alertPolicies.list`;
- `monitoring.alertPolicies.create`.

Sanitized evidence:

- run: `31924349410`;
- artifact id: `9257366328`;
- artifact archive digest: `sha256:689d196f5a89f48f0e82febc08da99897df0d04807b80cd82c412b3605f85e66`.

Read-only IAM probe `31924394406` repeated the project-IAM boundary check for both operations identities. Results:

- `toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`: `resourcemanager.projects.setIamPolicy` not granted;
- `toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`: `resourcemanager.projects.setIamPolicy` not granted;
- deployer: `monitoring.notificationChannels.list/create` not granted;
- deployer: `monitoring.alertPolicies.list/create` not granted.

Sanitized evidence:

- run: `31924394406`;
- artifact id: `9257378884`;
- artifact archive digest: `sha256:e10f1e86789e00dce02e6a8bcbeac72964c4dc563b1f70363d6c073c03e63cc3`.

This proves there is no authorized self-service path from the existing GitHub Workload Identity identities to grant the missing Monitoring permissions. The block is administrative at project IAM, not application code.

Minimum provider-admin action required on project `toca-mcp-production`:

- grant `roles/monitoring.notificationChannelEditor` to `serviceAccount:toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`;
- grant `roles/monitoring.alertPolicyEditor` to `serviceAccount:toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`.

Do not grant either role to the Cloud Run runtime service account. Do not grant broad `roles/monitoring.admin`, project Owner, project Editor, or service-account-key permissions merely to close alerting.

After that external IAM grant, the required completion sequence is deterministic:

1. inventory existing managed notification channels and reuse the approved operator channel if one exists;
2. create only the minimum Cloud Monitoring alert policies needed for Foundation daily-control failure, stalled Outbox, stale scheduler/workflow execution, Audit Ledger integrity failure, Cloud Run/runtime unavailability and schema-migration deployment failure where the source signal exists;
3. preserve the canonical P0/P1/P2 classification and do not duplicate application metrics;
4. execute a safe firing test and prove the incident reaches the approved managed channel;
5. read back channels and policies and store provider evidence;
6. only then change the truthful status from `BLOCKED_IAM` to `PASS` for alert routing.

Until those provider-admin steps are possible, telemetry and SLO evaluation are **PASS**, while managed alert policy, notification channel and firing-test delivery remain **BLOCKED_IAM**.

## Disaster-recovery restore permissions — read-only proof

Run `31914127336` used the deployer identity to call Google Cloud `testIamPermissions` only. It did not create, clone, restore, modify or delete any Cloud SQL resource.

Granted permissions among the requested DR set were exactly:

- `cloudsql.backupRuns.get`;
- `cloudsql.backupRuns.list`;
- `cloudsql.instances.get`.

Not granted:

- `cloudsql.instances.create`;
- `cloudsql.instances.delete`;
- `cloudsql.instances.clone`;
- `cloudsql.instances.restoreBackup`.

Sanitized evidence artifact:

- artifact id: `9254461931`;
- archive digest: `sha256:455ae4fdd5fa4ff061d784259249d04e0db16d13cb55b2f259447d6c84209344`.

This proves that a real isolated Cloud SQL restore drill cannot currently be executed by the deployer. The repository infrastructure control plane also intentionally forbids arbitrary instance create/restore/delete. Both IAM and policy therefore fail closed.

## Current truthful closeout state

Validated now:

- deterministic SLO/error-budget evaluator;
- P0/P1/P2 classification;
- structured telemetry and Prometheus surfaces;
- immutable Audit Ledger verification;
- Outbox and stale-job daily checks;
- real Cloud SQL backup/PITR/deletion-protection readback;
- one-per-day read-only Foundation control implemented inside the existing daemon;
- documented RPO/RTO objectives and fail-closed recovery ordering.

Provider-admin validation still required outside the current permission envelope:

1. grant the minimum Cloud Monitoring read/configuration permissions to an approved operations identity;
2. configure and test P0/P1 managed notification routing;
3. separately approve a tightly bounded Cloud SQL DR identity/operation with create/restore/delete permissions only for an isolated drill target;
4. execute the timed restore drill and record measured RPO/RTO;
5. remove or revoke the temporary DR mutation privilege after the drill if it is not needed for normal operations.

Until those administrative prerequisites exist, the correct statement is: **reliability code and live recovery safeguards are validated; managed alert delivery and provider restore drill remain blocked by explicit IAM/control-plane boundaries.**
