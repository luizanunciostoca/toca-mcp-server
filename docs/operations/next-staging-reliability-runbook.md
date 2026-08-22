# TOCA OS Next — Staging Reliability Runbook

Status: **STAGING RUNBOOK — RELIABILITY PROMOTION GATED**

This runbook applies only to the isolated TOCA OS Next staging environment. It does not authorize production, provider, database, backup/DR, traffic, Cloud Run or secret mutation.

## Frozen application candidate

- application candidate SHA: `75c165a044c6e79e9545328dd04a2a3e73d2e910`;
- MCP revision: `toca-mcp-next-staging-mcp-75c165a-r3`;
- webhook revision: `toca-webhook-next-staging-webhook-75c165a-f1`;
- staging project: `toca-mcp-next-staging` (`729069789107`);
- production project is distinct and out of scope.

Repository `main` may advance through control-plane/reliability changes without replacing the frozen application candidate. Never infer a new runtime candidate from the repository head alone.

## Governed Reliability resources

Runtime observability:

- dashboard: `projects/729069789107/dashboards/0d43a83f-77ff-4dce-8b9b-f873c8993b14`;
- webhook uptime check: `projects/toca-mcp-next-staging/uptimeCheckConfigs/toca-next-staging-webhook-readiness-4A6anP8jjnU`;
- readiness path: `/readyz`;
- expected unauthenticated response: HTTP `403`;
- authenticated uptime identity: Monitoring service-agent OIDC.

Synthetic notification delivery:

- alert policy: `projects/toca-mcp-next-staging/alertPolicies/5562724679805698256`;
- display name: `TOCA Next Staging - Synthetic Reliability Delivery`;
- condition: `TOCA staging synthetic log marker`;
- managed labels: `toca_managed=staging_reliability`, `alert_role=synthetic_delivery`;
- notification families: `email` and `webhook_tokenauth`;
- alert strategy: notification rate limit `300s`, auto-close `1800s`;
- authoritative 2026-08-22 synthetic incident: `projects/toca-mcp-next-staging/alerts/0.obqbjhmrmmv8`.

## Known evidence references

- Runtime Observability run: `32563386689`;
- Runtime Observability artifact: `9473430379`;
- Runtime Observability artifact ZIP SHA-256: `4a426268cff5556085b90c6abf6f49d6ac99633d531a16f135ae50125ca63b0d`;
- uptime observation: `101` true points, `0` false points;
- synthetic alert run: `32563070906`;
- synthetic signal timestamp: `2026-08-22T08:45:32.844128223Z`;
- email recipient receipt: `2026-08-22T08:46:05Z`;
- initial exact-incident readback: `OPEN` at `2026-08-22T09:08:31Z`, still inside the 30-minute auto-close eligibility window;
- canonical reconciliation: `ops/evidence/staging-reliability-reconciliation-2026-08-22.json`.

## Triage order

1. Confirm the project is exactly `toca-mcp-next-staging` and reject production project ID/number.
2. Confirm the frozen application release SHA on both staging services before interpreting runtime symptoms.
3. Read the dashboard and uptime-check configuration; do not recreate resources merely because a UI is unavailable.
4. For webhook readiness, require unauthenticated `/readyz` to remain private (`403`) and require OIDC `check_passed=true` evidence for positive readiness.
5. For synthetic notification incidents, read the exact alert policy and exact incident. Do not manually close an incident solely to make a gate green.
6. Treat `monitoring.googleapis.com/notification_channel_events` as delivery-error diagnostics, not as positive recipient receipt.
7. Require independent recipient-side evidence when a gate explicitly requires positive delivery proof.
8. Preserve all provider execution as disabled/unverified unless a separate provider-verification workflow and authorization applies.
9. Preserve `RELIABILITY_VERIFIED=false` until every required gate is backed by evidence.

## Synthetic incident recovery gate

For the 2026-08-22 incident, recovery is accepted only when a read-only exact-incident readback proves:

- incident resource matches `projects/toca-mcp-next-staging/alerts/0.obqbjhmrmmv8`;
- policy matches `projects/toca-mcp-next-staging/alertPolicies/5562724679805698256`;
- state is `CLOSED`;
- close time is non-empty;
- no manual-close mutation was required;
- no production/provider/database/backup/DR/traffic/Cloud Run/secret mutation occurred.

If the incident remains `OPEN` before the auto-close eligibility period has elapsed, record it as a transient observation, not a recovery failure.

## Notification delivery gate

Email delivery can be promoted only from positive recipient-level receipt. The 2026-08-22 synthetic alert has such evidence.

Webhook delivery remains unproven until independent receiver-side positive receipt/readback is available. Zero Cloud Monitoring delivery-error events is useful negative diagnostic evidence but is insufficient for a positive receipt claim.

Do not access or disclose the configured webhook URL/token merely to manufacture receipt evidence.

## Escalation boundaries

The following require separate explicit authorization and are not granted by this runbook:

- production deployment or production mutation;
- provider calls or provider state mutation;
- database writes or migrations;
- backup creation, restore, PITR or DR rehearsal;
- Cloud Run revision/configuration mutation;
- traffic changes;
- secret access or mutation.

If a required Reliability proof depends on one of these operations, stop at `BLOCKED` and record the exact missing authorization/evidence.

## Exit criteria

Staging Reliability may only be promoted when all applicable requirements are evidenced, including:

- frozen candidate still serving the accepted staging revisions;
- runtime dashboard and private-webhook OIDC uptime readback;
- governed synthetic firing;
- positive required notification delivery evidence;
- exact incident recovery/closure readback;
- runbook correlation to the exact policy/incident;
- separately authorized isolated DR rehearsal with RPO `<=15m`, RTO `<=60m`, cleanup and production-unchanged proof.

Until then, the correct lifecycle state is `STAGING_VERIFIED=true`, `RELIABILITY_VERIFIED=false`.
