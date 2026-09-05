# TOCA OS Android Tablet — vertical slice v1

Status: live App Gateway PREPARE integration / no provider side effects.

This project implements the first TOCA OS Android Tablet flow:

`BOOTSTRAP → AUTH REQUIRED/READY → HOME → CREATE CONTENT/VIDEO WIZARD → RECOMMENDATION → PREPARE → REVIEW → RESULT`

## Architecture boundary

The Android app is a client. It must never contain Meta, Google, Drive, GCP, model-provider or MCP service credentials. It does not decide policy or approval. Governed execution is expected to flow through:

`Android → TOCA App Gateway/BFF → toca-mcp-server Core → provider → provider readback`

The server-backed path hydrates Action Cards and the governed video-route catalog from the App Gateway, and prepares typed `TOCA_ACTION` requests. The current remote boundary is intentionally **PREPARE_ONLY**: it does not publish, schedule, activate paid media or execute provider mutations.

`FakeActionGateway` remains available only for an explicitly selected debug/demo path. Release runtime fails closed when the App Gateway origin or an app-session token is unavailable.

## App-session boundary

- Session token is held in memory only by default.
- HTTP 401 invalidates the in-memory session and returns the UI to `AUTH_REQUIRED`.
- The Android client accepts only the TOCA app/session token; provider credentials are forbidden.
- Remote App Gateway origins require HTTPS. Loopback HTTP is permitted only for local development.
- A production caller-specific login remains blocked until a canonical application-level OAuth/OIDC verifier and issuer/audience trust configuration are selected and validated.

## App Gateway origin

Provide the remote origin at build time:

```bash
gradle :app:assembleDebug -PtocaAppGatewayBaseUrl=https://<approved-app-gateway-origin>
```

The value is validated by the Android endpoint policy. Embedded credentials, query strings, fragments and non-root paths are rejected.

## Build

Requirements:

- JDK 17
- Android SDK 35
- Gradle compatible with Android Gradle Plugin 8.7.3

From this directory:

```bash
gradle :app:testDebugUnitTest
gradle :app:assembleDebug
```

## Current implemented surface

- capability-driven Home / Action Launcher;
- create-content and create-video wizard;
- all ten governed video creation routes from the canonical TOCA OS video manual;
- authenticated App Gateway read/prepare transport;
- memory-only session bootstrap;
- fail-closed `BOOTSTRAPPING`, `AUTH_REQUIRED`, `READY`, `LOADING`, and `ERROR` states;
- truthful PREPARE-only result state for the remote path;
- immutable approval-preview fields when supplied by the Core.

## Next implementation gates

1. Compose the App Gateway into the main HTTP runtime behind an injected, validated application authorization boundary.
2. Select and validate the canonical application OAuth/OIDC verifier before enabling caller-specific production login.
3. Add SSE action-event transport only when an execution-capable Core endpoint exists; do not simulate execution on the remote path.
4. Add safe read-only caching/retry without caching secrets or turning failed writes into retries.
5. Add staging acceptance before any production/provider execution claim.
