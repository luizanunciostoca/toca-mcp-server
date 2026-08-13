# Marketing Autopilot production publication pipeline

Status: implementation candidate. The TOCA OS remains the source of truth for editorial state, approval policy, capabilities and write-back.

## Purpose

Replace the one-off first-publication GitHub workflows with a reusable, fail-closed execution lane that can be driven by the hourly TOCA Marketing Autopilot worker without requiring `workflow_dispatch` for each routine step.

The bridge is `control/marketing-autopilot-publication-command.json`. Updating that single command file on `main` triggers `Marketing Autopilot Publication`. The command file is an execution envelope only; it is never operational memory.

## Supported operations

- `NOOP`: no side effect.
- `PREPARE`: downloads exactly one approved Drive JPEG privately, stages it in the private publication bucket, produces an immutable approval manifest and request SHA-256, and never enables Instagram publication writes.
- `PUBLISH`: requires a prepared request SHA-256 plus explicit approval, enforces the publication time window, executes exactly one idempotent publication, immediately disables write capability, verifies `PUBLISHED` against the provider and persists immutable evidence.

Supported media classes in this version are `FEED_IMAGE` and `STORY_IMAGE`, mapped to Meta media types `IMAGE` and `STORY`. Image stories use the Meta `STORIES` container with `image_url`; existing video-story behavior remains supported by the underlying builder when the runtime receives a video URL, but this command lane intentionally accepts JPEG images only.

## Approval gate

The production command lane currently accepts publication only when:

- `approvalMode=EXPLICIT_APPROVAL`;
- `approvalStatus=APPROVED`;
- `approvedRequestSha256` exactly matches the SHA-256 produced by the prior preparation step.

`PREAPPROVED_CLASS` is deliberately not enabled in the deterministic workflow. The current TOCA OS approval policy still requires explicit approval for Sunset and The Party publications. A future preapproved class requires a separate formal governance decision and code/policy change after sufficient production evidence.

## Time and asset-lifetime gates

All command timestamps must be explicit `America/Bahia` clock values encoded with `-03:00`.

Preparation is accepted only from four hours before through thirty minutes after the scheduled slot. This keeps the staged private GCS signed URL inside its validity window. Publication is accepted only from fifteen minutes before through thirty minutes after the scheduled slot.

## Safety properties

- fixed production Instagram account allowlist;
- fixed `America/Bahia` timezone;
- allowed operations and image formats only;
- JPEG-only publication lane until additional media encodings are separately production-validated;
- source Drive file downloaded privately with read-only Drive scope;
- preparation runs with `INSTAGRAM_PUBLICATION_WRITES_ENABLED=false`;
- publication accepts only a request whose SHA-256 exactly matches prior preparation evidence;
- command caption, correlation ID, idempotency key, account and media type must match the prepared manifest;
- no `workflow_dispatch` trigger exists for the production command lane, preventing manual replay of a stale command;
- a single concurrency lane prevents parallel publication commands;
- the publication request is passed to Cloud Run as base64 to avoid delimiter/caption corruption;
- write capability is disabled immediately after execution even on failure;
- provider verification must return `PUBLISHED` and a publication ID;
- preparation evidence is retained 30 days; publication evidence 90 days;
- temporary Cloud Run jobs are removed after each operation.

## Scheduled Tasks integration

The ChatGPT Scheduled Task remains the cognitive clock, as required by `TOCA_OS — MARKETING_AUTOPILOT_WORKER_CONTRACT_v1.0`. Each hourly run must re-read canonical TOCA OS sources and the content registry, choose the highest-priority eligible action, and only then update the command file when a `PREPARE` or `PUBLISH` side effect is eligible.

The task must not use the command file as operational memory. State and evidence are written back to `TOCA_OS — MARKETING_AUTOPILOT_CONTENT_REGISTRY_v1.0` using content item IDs, execution IDs, correlation IDs, provider external IDs and errors.

The hourly worker may autonomously plan, brief, produce, quality-check and prepare eligible content. When the current TOCA OS policy requires explicit publication approval, it must surface the exact prepared request SHA-256 to the user, record the approval decision in TOCA OS, and only then issue a `PUBLISH` command during the allowed time window.

## First production validation after merge

Do not immediately promote any class to `PREAPPROVED_CLASS`. Validate the generic lane first with an explicitly approved Sunset image item. After repeated successful executions and provider-verifiable evidence, governance may separately decide whether the evidence is sufficient to define and promote a routine preapproved class.
