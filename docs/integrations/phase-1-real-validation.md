# Phase 1 — Real validation gate

This checklist is the boundary between code-complete Phase 1 and a genuinely connected Meta/ChatGPT environment.

## A. Meta App prerequisites

- Create or select the Meta App owned by the Toca business context.
- Record the non-secret App ID in the official external-account catalog.
- Store the App Secret only in the selected secret manager; never in GitHub or TOCA_OS.
- Configure the exact OAuth redirect URI used by the validation environment.
- Enable only the products and permissions required for the first read-only validation.
- Keep production writes disabled.

## B. Initial permissions

The first validation must request only scopes required to prove account, Page and Instagram professional account visibility. Advertising write scopes and Instagram publishing scopes are not part of this gate.

The actual granted scopes returned by Meta token inspection are authoritative. Requested scopes alone are not evidence of permission.

## C. Real Meta proof

The validation run must prove all of the following with an owned or authorized test account:

1. OAuth state is generated and consumed exactly once.
2. Authorization callback is accepted only with matching, unexpired state.
3. Access-token value is persisted behind `SecretStore` and absent from tool output and logs.
4. `/debug_token` confirms a valid token and correct Meta App ownership.
5. Granted scopes are recorded from provider evidence.
6. Managed Page discovery succeeds.
7. Linked Instagram professional account ID is discovered when present.
8. Failed, expired or revoked credentials produce `DEGRADED` state rather than false `CONNECTED` state.
9. Reauthentication or reconnect path is exercised.

## D. Remote MCP proof

- Start the remote Streamable HTTP runtime.
- Keep the service private for initial validation by using a supported secure MCP tunnel or another authenticated private route.
- Confirm `/healthz` without exposing business data.
- Configure the TOCA MCP endpoint in ChatGPT developer mode.
- Scan tools successfully.
- Confirm that the runtime advertises only `system.health` and `system.capabilities` at this stage.
- Confirm that no Instagram or Meta Ads write tool is visible.

## E. Promotion rule

Do not merge Phase 1 as a connected or production-ready integration merely because CI is green.

Promotion requires both:

- repository Quality Gate green; and
- real-provider plus real-ChatGPT evidence from sections C and D.

Only after this gate may read-only Meta and Instagram capabilities be promoted from `IMPLEMENTED` to `CONNECTED`. `PRODUCTION_VALIDATED` requires the later production-validation checklist.

## F. Current status

The repository implementation is code-complete for this phase and remains intentionally in draft. The outstanding work is external validation: configuring a real Meta App and owned/test account, wiring a real Secret Store implementation, exposing the MCP through a private or authenticated route, and scanning it from ChatGPT. These steps must not be simulated or inferred from repository tests.
