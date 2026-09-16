# Google Cloud production foundation

Authority review: 2026-09-16.

Target runtime: Cloud Run + Artifact Registry + Secret Manager + Cloud SQL for TOCA OS workloads that require Google Cloud infrastructure.

## Security model

- Cloud Run workloads are private by default.
- GitHub reaches authorized GCP workloads through Workload Identity Federation; no long-lived Google service-account key belongs in GitHub.
- Runtime identities receive only the permissions required by the exact workload.
- Meta credentials remain in Secret Manager and are never committed to the repository, artifacts, logs, issues, PRs or chat.
- Production publication uses the canonical secret `toca-meta-oauth-token` plus the existing `toca-meta-app-secret`; the deprecated/nonexistent `toca-meta-access-token` resource must not be referenced.
- Cloud SQL and Secret Manager references used by publication must be version-pinned when an accepted production-readiness proof requires an exact version.

## Required external foundation

The production foundation already exists in project `toca-mcp-production`. Any future bootstrap or replacement must preserve these controls:

1. Cloud Run, Artifact Registry, Cloud SQL, Secret Manager, IAM Credentials and required APIs enabled.
2. Artifact Registry repository `toca-mcp`.
3. Runtime service account with least authority.
4. GitHub Workload Identity Federation bound only to approved repository/ref conditions.
5. Secret-level access to only the required Meta/database secrets.
6. Cloud SQL access only where the publication runtime requires persistence/reconciliation.
7. No broad infrastructure-administrator identity may be used as the publication runtime identity.

## Canonical Instagram publication transport — GCP

The canonical Instagram publication writer is the governed GCP execution boundary:

`protected main authority → GitHub Actions control plane → WIF → immutable Artifact Registry image digest → Cloud Run Job → Secret Manager → Meta provider → provider readback → evidence`.

There are two governed control surfaces sharing the same hardened writer:

- `.github/workflows/marketing-publish-now.yml` handles fresh, explicitly approved SHARE_NOW commands from `control/marketing-publish-now-command.json`;
- `.github/workflows/marketing-autopilot-publication.yml` handles due, explicitly approved scheduled items from `control/gcp-instagram-publication-queue.json`.

The runtime implementation is `scripts/marketing-publish-now.sh`, verified by `scripts/marketing-publish-now-fixed.sh`. The compatibility wrapper does not repair production source at runtime; it verifies that the committed source already satisfies the hardened contract before execution.

Scheduled selection is performed by `scripts/marketing-scheduled-publication-controller.mjs`. It generates a fresh ephemeral provider command only after an approved item reaches its protected schedule window. It never changes the approved caption merely to satisfy fast-path copy rules.

### Publication authority requirements

A write-capable execution must prove all of the following before contacting Meta:

- protected `main` and exact audited code SHA;
- valid `America/Bahia` time boundary;
- explicit approval and `publicationIntent=SHARE_NOW` at execution time;
- exact target Instagram account;
- exact Drive file ID and JPEG MIME type;
- exact SHA-256 binding to Creative Truth output;
- brand/Creative Truth gates required by the selected policy;
- rights clearance bound to the same asset and unexpired when an expiry exists;
- stable correlation ID and idempotency key;
- WIF-authenticated Drive download using the short-lived Google access token;
- immutable application and preparation images resolved to Artifact Registry `@sha256` digests;
- pinned database secret version;
- write capability enabled only on the exact execution job.

FAST_PATH additionally keeps the required CTA/five-hashtag policy. SCHEDULED mode instead binds the exact caption and caption SHA from the approved Content Registry snapshot, refuses execution before `scheduledAt`, and refuses automatic execution after the maximum delay window.

After every side-effect attempt, successful or not, the controller must disable publication writes and independently read back the Cloud Run Job configuration. A publication may be accepted only when provider readback confirms `PUBLISHED` for the exact approved request and a final write-disable verification succeeds. Otherwise the outcome is `RECONCILIATION_REQUIRED` and the workflow fails closed.

Evidence must include the correlation/idempotency identity, approved request SHA, immutable image references, execute result, disable result, provider-readback result and final write-disable verification.

## GitHub-native publication lane — SHADOW only

`.github/workflows/github-native-instagram-publisher.yml` is retained only as a read-only/shadow comparison and recovery reference. It is not an authorized production writer.

It must remain fail-closed with publication writes disabled and must not expose a write-capable `repository_dispatch` path. The expired GitHub-native canary window/recovery controllers are retired and must not be restored without a new architecture decision.

There is no automatic fallback from GCP publication to GitHub-native publication. This prevents dual-writer ambiguity and duplicate-provider risk.

## Retired GCP worker/daemon topology

Restoring the governed GCP fast-path and scheduled writer does **not** revive the older long-running publication worker/daemon topology.

The historical publication deployment workflows remain retirement boundaries:

- `.github/workflows/deploy-instagram-publication-worker-gcp.yml`;
- `.github/workflows/deploy-toca-managed-instagram-daemon-gcp.yml` for publication authority.

A physical Cloud Run service with the daemon name may still serve governed Instagram engagement workloads, but engagement authority must preserve `INSTAGRAM_PUBLICATION_WRITES_ENABLED=false` and must never inherit publication-write authority.

## Rollout rule

Infrastructure readiness alone does not authorize a provider write. Promotion follows:

`PRECHECK → CANARY → provider readback → duplicate/idempotency reconciliation → LIMITED → repeated verified operation`.

Scheduler infrastructure is merged with its queue disabled and empty. A live CANARY item is introduced separately only after the scheduler merge SHA is known, allowing `targetCodeSha` to be pinned to the exact audited implementation without publishing the item early.

A CANARY is successful only when the exact approved asset/caption/account is published once at its approved schedule, the provider returns a durable external publication identity, independent readback confirms it, evidence is persisted, and the write capability is proven disabled after the attempt.

Until that proof exists, TOCA OS scheduled publication must be described as armed/pending-canary rather than fully production-accepted.
