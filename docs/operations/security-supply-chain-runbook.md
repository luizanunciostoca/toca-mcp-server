# TOCA OS Next — Security and Supply Chain Runbook

Status: **IMPLEMENTED CONTRACT / CI EVIDENCE REQUIRED**

Route: `R24 SECURITY_AND_SUPPLY_CHAIN`

This runbook extends the V1 controls. It does not replace the V1 Production Verified evidence, the existing Policy Engine, Approval Engine, Audit Ledger, Secret Manager integration, Workload Identity Federation, or infrastructure control plane.

## Mandatory repository gate

Normal changes must enter `main` through a pull request whose exact head passed the canonical `Quality Gate`. The repository-side contract now also requires `scripts/platform-hardening-check.mjs` from Quality. Hosted branch/ruleset enforcement must be independently read back before it is claimed as enforced; `protected=true` alone is not evidence that a specific required check is configured.

Break-glass is not an alternative development path. It is permitted only during an active production/security incident when the normal PR path is materially unsafe or unavailable, for the minimum patch, with incident evidence and immediate follow-up reconciliation plus full Quality.

## Supply-chain controls

`.github/workflows/security-supply-chain.yml` provides the permanent security workflow:

- dependency change review on pull requests;
- Node dependency vulnerability audit;
- GitLeaks secret scanning;
- Trivy filesystem vulnerability scanning;
- immutable candidate image build;
- Trivy container vulnerability scanning;
- CycloneDX SBOM generation and retained workflow artifact;
- CodeQL JavaScript/TypeScript analysis.

All external GitHub Actions remain pinned to full 40-character commit SHAs. `scripts/check-workflow-supply-chain.mjs` remains the canonical repository-wide pin/permissions validator and is not duplicated.

High/Critical dependency, filesystem or container findings fail their security job. Remediation must update the affected dependency/base image/configuration; do not suppress a finding solely to make CI pass.

## Identity and least privilege

Canonical production identities remain separate:

- deploy: `toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`;
- runtime: `toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`;
- privileged infrastructure: `toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`.

GitHub authentication uses the immutable WIF provider resource:

`projects/990081828836/locations/global/workloadIdentityPools/github/providers/github-toca-mcp`

Long-lived service-account JSON keys are forbidden. Normal deploy/runtime identities must not receive project-wide Owner/Editor or service-account-key creation permissions. Privileged infrastructure changes stay behind the existing manual infrastructure control plane.

## Secret Manager and rotation

Runtime secrets are references to Google Secret Manager versions. Secret values must never be committed, echoed into workflow logs, copied into evidence documents, or stored in TOCA OS registries.

Rotation procedure:

1. create a new managed secret version without changing the application contract;
2. verify the target runtime identity can access only the required secret reference;
3. deploy through the normal governed deployment path;
4. perform authenticated/read-only or bounded provider readback;
5. verify structured logs contain no secret material;
6. disable the superseded secret version only after new-version readback succeeds;
7. record rotation evidence by secret resource/version identifier, never by value.

Expired provider credentials follow the same fail-closed rule: do not switch to an undocumented credential or bypass provider verification.

## Audit integrity

`src/core/audit-ledger.ts` remains the canonical hash-chained audit implementation. `verifyAuditLedger` must remain available and a failed integrity verification is P0. Platform hardening must not introduce an alternate audit store or mutable replacement for the existing ledger/outbox/event records.

## Incident handling

For a suspected secret leak or supply-chain compromise:

1. stop promotion/deployment of the affected SHA;
2. preserve workflow, commit and artifact evidence;
3. rotate/revoke affected credentials through managed provider controls;
4. verify WIF trust, IAM bindings and runtime/deployer separation;
5. reconcile provider truth before retrying any ambiguous mutation;
6. run canonical Quality plus Security Supply Chain on the remediation head;
7. perform provider/readback only to the minimum non-destructive extent required;
8. document impact, root cause, evidence and prevention actions.

## Evidence promotion

- repository/workflow contracts present: `IMPLEMENTED`;
- exact-head Quality and Security Supply Chain green: `CI_VERIFIED`;
- hosted IAM/Secret Manager/scanner/provider controls independently read back where applicable: `PROVIDER_VERIFIED`;
- production deployment and post-deploy readback on that exact release: `PRODUCTION_VERIFIED`.

Do not promote a state from repository configuration alone.
