# Marketing Autopilot production publication pipeline

Status: implementation candidate. The TOCA OS remains the source of truth for editorial state, approval policy, capabilities and write-back.

## Purpose

Replace the one-off first-publication GitHub workflows with a reusable, fail-closed execution lane that can be driven by the hourly TOCA Marketing Autopilot worker without requiring `workflow_dispatch` for each routine step.

The bridge is `control/marketing-autopilot-publication-command.json`. Updating that single command file on `main` triggers `Marketing Autopilot Publication`.

## Supported operations

- `NOOP`: no side effect.
- `PREPARE`: downloads exactly one approved Drive image privately, stages it in the private publication bucket, produces an immutable approval manifest and request SHA-256, and never enables Instagram publication writes.
- `PUBLISH`: requires a prepared request SHA-256 plus a satisfied approval gate, enforces the publication time window, executes exactly one idempotent publication, immediately disables write capability, verifies `PUBLISHED` against the provider and persists immutable evidence.

Supported media classes in this version are `FEED_IMAGE` and `STORY_IMAGE`, mapped to Meta media types `IMAGE` and `STORY`.

## Approval gate

The pipeline does not promote governance by itself. It implements the two modes already defined by the TOCA OS policy:

- `EXPLICIT_APPROVAL` requires `approvalStatus=APPROVED` and an exact 64-character prepared request SHA-256.
- `PREAPPROVED_CLASS` requires `approvalStatus=PREAPPROVED_CLASS` and an exact prepared request SHA-256.

Until the TOCA OS formally promotes a content class, routine Sunset publications must continue using explicit approval. The worker may prepare items autonomously and stop at the approval gate.

## Safety properties

- fixed production Instagram account allowlist;
- fixed America/Bahia timezone;
- allowed operations/formats/content types only;
- source Drive file downloaded privately with read-only Drive scope;
- preparation runs with `INSTAGRAM_PUBLICATION_WRITES_ENABLED=false`;
- publication accepts only a request whose SHA-256 exactly matches prior preparation evidence;
- command caption, correlation ID, idempotency key, account and media type must match the prepared manifest;
- publication is accepted only from 15 minutes before through 30 minutes after the scheduled slot;
- a single concurrency lane prevents parallel publication commands;
- write capability is disabled immediately after execution even on failure;
- provider verification must return `PUBLISHED` and a publication ID;
- preparation evidence is retained 30 days; publication evidence 90 days;
- temporary Cloud Run jobs are removed after each operation.

## Scheduled Tasks integration

The ChatGPT Scheduled Task remains the cognitive clock, as required by `TOCA_OS — MARKETING_AUTOPILOT_WORKER_CONTRACT_v1.0`. Each hourly run must re-read canonical TOCA OS sources and the content registry, choose the highest-priority eligible action, and only then update the command file when a `PREPARE` or `PUBLISH` side effect is eligible.

The task must not use the command file as operational memory. State and evidence are written back to `TOCA_OS — MARKETING_AUTOPILOT_CONTENT_REGISTRY_v1.0` using content item IDs, execution IDs, correlation IDs, provider external IDs and errors.

## First production validation after merge

Do not immediately promote any class to `PREAPPROVED_CLASS`. Validate the generic lane first with one already-approved Sunset image item. After consistent successful executions, governance may separately decide whether the evidence is sufficient to promote a routine Sunset class.
