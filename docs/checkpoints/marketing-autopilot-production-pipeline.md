# Marketing Autopilot publication pipeline — LEGACY / RETIRED

Status: **RETIRED** as a production executor.

The historical command-file pipeline based on `control/marketing-autopilot-publication-command.json`, Google Cloud Workload Identity, Cloud Run, Cloud SQL and GCS is no longer the canonical TOCA OS Instagram publication path.

## Canonical replacement

The active architecture is documented in:

- `docs/operations/github-native-instagram-publication.md`
- `.github/workflows/github-native-instagram-publisher.yml`
- `.github/workflows/github-native-instagram-auto-stage-assets.yml`
- `control/github-native-publication-queue.json`

The canonical flow is:

`TOCA OS / Drive approval → protected queue sync → exact Drive asset staging → GitHub-native scheduler → Meta provider → independent readback → publication-state ledger`.

It does not use Cloud Scheduler, Cloud Run, Cloud SQL, GCS, Google Workload Identity Federation, Google Secret Manager or TOCA_POSTGRES for publication execution.

## Historical command workflow

`.github/workflows/marketing-autopilot-publication.yml` is retained only as an explicit retirement marker. A change to `control/marketing-autopilot-publication-command.json` can no longer authenticate to Google Cloud or execute PREPARE/PUBLISH side effects.

The former implementation remains recoverable from Git history before the retirement change. Restoring it is a new governance decision and must not happen as an automatic fallback.

## Approval boundary

Retiring the GCP lane does not weaken approval policy. Queue synchronization may plan, brief and mirror already-approved future content, but it must never manufacture approval or convert `PENDING`/`REVIEW` into `APPROVED`.

Provider writes remain fail-closed until the GitHub-native mode, exact account, write flag, exact approved item, asset hash and provider readback gates all pass.

## Incident rule

If GitHub-native execution is unavailable or provider state is uncertain, prefer a missed publication over duplicate or unverified publication. Never fall back automatically to the retired GCP command lane.
