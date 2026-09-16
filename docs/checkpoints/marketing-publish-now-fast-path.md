# Marketing Publish Now — canonical GCP writer

Status: **LIMITED / canonical writer**.

`Marketing Publish Now` is the only TOCA OS Instagram provider-write transport. GitHub-native publication is SHADOW/read-only and the former direct GCP autopilot publisher topology is retired.

## Invocation modes

The workflow supports two governed invocation modes:

1. **Protected command file** — a deliberately merged `control/marketing-publish-now-command.json` containing `PUBLISH_NOW`.
2. **Marketing Autopilot scheduler dispatch** — `main` must remain durably `NOOP`; the workflow receives only the exact scheduled Content Registry item ID and generates a fresh PUBLISH_NOW envelope ephemerally from protected policy + the live registry.

The second mode does not create a second writer. It reaches the same hardened GCP execution path after the same Creative Truth, rights, exact-asset, idempotency, write-disable and provider-readback controls.

## Caption policy

Every Instagram caption published through this lane MUST contain:

1. the exact CTA `Ingressos limitados! garanta o seu pelo link na bio.`;
2. exactly five hashtags relevant to the approved content.

The scheduler is not allowed to compose or alter copy. Its CANARY binding stores the exact previously approved caption and verifies the registry message/CTA before use.

## Core execution contract

A PUBLISH_NOW envelope requires explicit approval, a fixed production Instagram account, exact Drive file ID, exact SHA-256, approved caption, Creative Truth binding, deterministic brand binding, rights clearance, correlation, idempotency and a fresh `issuedAt`.

For scheduler-generated envelopes, the exact protected-main SHA is the `targetCodeSha`; the workflow rechecks the Content Registry after detaching to that audited tree. The durable command file on main remains NOOP.

## Hardened single-attempt flow

The writer:

1. validates the invocation and command freshness;
2. authenticates through Workload Identity Federation;
3. binds execution to the exact audited protected-main code SHA;
4. for scheduler dispatches, revalidates the Content Registry at execution time;
5. downloads the exact approved Drive asset using an authenticated bearer token;
6. recalculates SHA-256 and fails on any mismatch;
7. prepares the provider request with publication writes disabled;
8. resolves immutable Artifact Registry image digests;
9. enables publication only for the exact approved request;
10. executes one idempotent publication attempt;
11. disables publication writes immediately after the attempt;
12. performs provider readback;
13. verifies publication writes remain disabled;
14. declares success only for a verified PUBLISHED result with provider publication ID;
15. persists immutable evidence.

Any ambiguous outcome is `RECONCILIATION_REQUIRED`; there is no blind retry.

## Registry reconciliation

For Marketing Autopilot dispatches only, a verified provider result is written back to the canonical Content Registry after the provider readback and final write-disable checks pass. The Registry is never marked PUBLISHED from a local execution exit code alone.

If Registry reconciliation fails after provider success, the workflow fails closed as a reconciliation incident. Subsequent scheduler runs detect the prior writer attempt and refuse to republish automatically.

## CI and protected-main policy

Code, workflow and policy changes continue through the normal protected-main PR process and required quality/security checks. Individual scheduled publications do not create a code PR; they use already-reviewed code and protected CANARY policy, plus the live explicit approval recorded in the Content Registry.
