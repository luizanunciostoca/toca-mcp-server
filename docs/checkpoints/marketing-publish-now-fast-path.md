# Marketing Publish Now — fast path

Status: implementation candidate.

## Goal

Provide a routine operational lane for direct Instagram publication that is substantially faster than the historical first-production validation flow while retaining the controls that materially prevent a wrong or duplicate external side effect.

User experience target:

`publish now request -> one approved command -> one protected merge -> one workflow -> provider readback -> publication evidence`

The legacy `PREPARE -> external hash approval -> PUBLISH` lane remains available for scheduled or exceptional validation, but it is not the preferred path for routine `SHARE_NOW` publication.

## Caption policy

Every Instagram caption published through this lane MUST contain:

1. the exact CTA: `Ingressos limitados! garanta o seu pelo link na bio.`
2. exactly five hashtags relevant to the content and operation.

Missing CTA, modified mandatory CTA, fewer than five hashtags or more than five hashtags fails closed before provider access.

## Command contract

The execution envelope is `control/marketing-publish-now-command.json`.

Supported actions:

- `NOOP`
- `PUBLISH_NOW`

`PUBLISH_NOW` requires:

- `approvalMode=EXPLICIT_APPROVAL`
- `approvalStatus=APPROVED`
- `publicationIntent=SHARE_NOW`
- a fixed production Instagram account
- a Drive file ID
- `expectedAssetSha256` binding the approval to the exact asset bytes
- the complete approved caption
- correlation and idempotency keys
- a fresh `issuedAt` timestamp; stale commands are rejected.

## Single-run execution

The workflow performs the following in one run:

1. validates the approved command and caption policy;
2. rejects commands older than 30 minutes or more than 2 minutes in the future;
3. downloads the Drive JPEG privately;
4. validates MIME type and exact SHA-256 against `expectedAssetSha256`;
5. builds one application image and one small immutable preparation wrapper;
6. runs preparation with Instagram publication writes disabled;
7. captures the prepared manifest using bounded retry/backoff;
8. derives the exact request SHA-256 inside the same approved execution;
9. deploys the execution job with writes enabled only for that exact request SHA-256;
10. executes one idempotent publication;
11. disables write capability immediately;
12. performs read-only provider verification;
13. requires `PUBLISHED` plus a provider publication ID before success;
14. retains preparation and publication evidence for 90 days;
15. removes temporary Cloud Run jobs.

## Why this is safe enough for routine direct publication

The old two-command mechanism was useful during first production validation because it forced a human to approve a provider-resolved request hash in a second cycle. For a routine direct-publication command, that extra round trip provides little additional protection when the command already binds:

- exact asset bytes by SHA-256;
- exact caption;
- fixed account;
- fixed format;
- explicit approval;
- freshness window;
- idempotency key;
- fail-closed preparation;
- exact internally generated request hash;
- provider readback.

This lane therefore preserves immutability and provider verification but removes the separate PREPARE PR/run, external hash approval and second PUBLISH PR/run.

## CI policy

The operational workflow intentionally does not run `pnpm install` and the full `pnpm quality` suite again after merge. `main` is protected and already requires the repository quality/security contexts before a command can land. Re-running the full code-quality suite inside every social-media operation adds latency without changing the certified application tree.

Any code or workflow change still goes through normal branch protection and CI before merge.

## Future optimization

The remaining GitHub PR/merge cycle exists because the current execution trigger is a command file on protected `main`. The next optimization, once the new lane has provider-verified production evidence, is an authenticated TOCA OS/MCP `instagram.publish_now` operation that accepts the same immutable command contract directly. That would reduce the user experience to one approved TOCA OS action without weakening the exact-asset, idempotency or provider-readback controls.
