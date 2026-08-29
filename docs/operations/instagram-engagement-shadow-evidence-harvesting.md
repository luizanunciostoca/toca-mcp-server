# Instagram Engagement Shadow — Cloud Run Evidence Harvesting

## Purpose

The production shadow workflow consumes sanitized validation events emitted by temporary Cloud Run jobs. Cloud Logging may represent an application JSON line as either `jsonPayload` or `textPayload`, depending on ingestion and structured logging behavior.

The canonical extractor is `scripts/extract-instagram-engagement-cloud-run-evidence.mjs`. It accepts only these selectors:

- `instagram-engagement-readiness`
- `instagram-engagement-shadow-e2e`
- `instagram-engagement-meta-subscriptions`

It normalizes direct `jsonPayload`, a JSON object serialized under `jsonPayload.message`, or a JSON `textPayload`. It fails closed when the requested validator is absent, the log response is malformed, or an unsupported selector is supplied.

The workflow still performs semantic `jq` checks after extraction. Normalization therefore changes only how evidence is located; it does not weaken any PASS criterion.

External Instagram engagement reply writes remain disabled throughout the production shadow workflow (`INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`).
