# TOCA OS Android Tablet — first vertical slice

Status: prototype / no provider side effects.

This project implements the first UI slice defined by TOCA OS Android Tablet v1.0:

`HOME → CREATE CONTENT WIZARD → RECOMMENDATION → EXECUTION → REVIEW → RESULT`

## Architecture boundary

The Android app is a client. It must never contain Meta, Google, Drive, GCP, model-provider or MCP service credentials. It does not decide policy or approval. Production execution is expected to flow through:

`Android → TOCA App Gateway/BFF → toca-mcp-server Core → provider → provider readback`

The current `FakeActionGateway` is local-only UI data. Its availability values are not capability truth and must be replaced by the server-backed gateway before any production use.

## Build

Requirements:

- JDK 17
- Android SDK 35
- Gradle compatible with Android Gradle Plugin 8.7.3

From this directory:

```bash
gradle :app:assembleDebug
gradle :app:testDebugUnitTest
```

A Gradle wrapper is intentionally not checked in by this first slice; generate and commit it in the Android build lane after the pinned Gradle/AGP compatibility gate is confirmed.

## Next implementation gate

1. Add authenticated HTTP client for `/api/v1/actions` and `/api/v1/capabilities`.
2. Add SSE client for action events.
3. Replace `FakeActionGateway` with the server-backed implementation.
4. Bind immutable approval preview fields without recreating policy logic in the app.
5. Add offline/read-only cache and retry only for safe reads.
