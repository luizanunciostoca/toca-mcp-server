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
