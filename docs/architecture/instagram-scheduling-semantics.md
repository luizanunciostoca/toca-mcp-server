# Instagram scheduling semantics

## Canonical distinction

TOCA OS distinguishes provider-native scheduling from immediate API publication.

- `scheduled_at`: editorial target time owned by TOCA OS.
- `target_publish_at`: execution window for an immediate API `media_publish` operation.
- `provider_scheduled_at`: time confirmed by a provider-native scheduler.
- `provider_schedule_id`: identifier returned by a provider-native scheduler.

A local timer, ChatGPT Scheduled Task, GitHub Actions run, Cloud Run Job, or persisted worker schedule is not provider-native Instagram scheduling.

## State guard

`SCHEDULED` is valid only when all of the following provider evidence exists:

1. non-empty `provider_schedule_id`;
2. valid `provider_scheduled_at`;
3. provider status equal to `SCHEDULED`.

Without that evidence, a future content item must remain one of:

- `READY_FOR_NATIVE_SCHEDULING` when an automatable provider capability is available;
- `MANUAL_HANDOFF_REQUIRED` when scheduling must be completed in the provider UI;
- `READY_TO_PUBLISH_AT_WINDOW` when policy explicitly selects immediate API publication at a target window.

## Current Meta/Instagram integration

The current integration implements the media-container plus `media_publish` flow. It does not claim an automated provider-native scheduling endpoint. The Instagram professional-account UI may expose native scheduling for eligible formats, but that manual provider feature must not be inferred as an API capability.

Therefore:

- `scheduledAt` in the existing publication command remains backwards-compatible input for the immediate publication execution window;
- it is never evidence that Instagram has accepted a scheduled item;
- native scheduling requires separate provider evidence before TOCA OS can write `SCHEDULED`;
- unsupported native scheduling must fail closed as `PROVIDER_NATIVE_SCHEDULING_UNAVAILABLE` and use a manual provider handoff rather than a hidden timer.

## TOCA-managed delayed execution

The TOCA-managed scheduler is a durable local execution mechanism for `READY_TO_PUBLISH_AT_WINDOW`.
It does not convert a local delayed job into provider-native scheduling evidence.

For a managed publication:

- the approved descriptor binds the execution window, target account, ordered assets, caption,
  correlation identifier, and publication idempotency key;
- each asset is verified against its approved SHA-256 and content type before any Instagram side
  effect;
- `IMAGE` accepts exactly one image, `REEL` accepts exactly one `video/mp4`, `STORY` accepts one
  image or video, and `CAROUSEL` accepts two to ten ordered images;
- rescheduling replaces the immutable scheduled job atomically so cancellation of the old job and
  persistence of the replacement cannot be split across commits;
- provider reconciliation/readback remains authoritative for deciding whether an uncertain or
  completed execution actually resulted in a published Instagram resource.
