# TOCA OS FinOps Runtime Cost Capture and Reconciliation v1

Status: IMPLEMENTATION_CANDIDATE / OBSERVABILITY_ENFORCED

## Purpose

Connect the W-FINOPS-01 ledger to the production AG-01 Vertex Gemini decision path so every billable model decision has a pre-provider estimate and, when provider usage is available, an actual cost plus reconciliation evidence.

Stable flow:

`AG-01 CONTEXT -> COST ESTIMATE -> APPEND ESTIMATE -> VERTEX CALL -> USAGE METADATA -> APPEND ACTUAL -> APPEND RECONCILIATION`

This stage does not create a second authorization path. Core Policy/Approval remains authoritative for business effects.

## Production binding

Production AG-01 already requires `AG01_MODEL_PROVIDER=vertex`. W-FINOPS-02 instruments only that production path and reuses the verified Google Vertex pricing catalog from W-FINOPS-01. OpenAI remains available for non-production development configuration, but no OpenAI cost is fabricated until a separately verified price catalog exists.

The runtime creates a scoped cost execution context carrying execution, correlation, tenant, workspace and organization identifiers. The Vertex adapter never persists prompt or response content into FinOps. It sends only bounded usage measurements and hashed provider evidence references to the cost observer.

## Estimate

Immediately before the existing Vertex `generateContent` call, the adapter measures the exact serialized governed request in UTF-8 bytes and converts it to a conservative token estimate using `ceil(bytes / 3)`. The configured maximum output tokens are used as the output ceiling. Cached input is estimated as zero because provider cache usage is not known before the response.

The estimate is priced with the pinned catalog in integer micro-USD and appended as an `ESTIMATE` CostEvent before the billable request. If the configured production model has no verified price, accounting fails closed before the provider call. This is a metering precondition, not model routing or automatic model substitution.

## Actual usage

After a successful Vertex response, `usageMetadata.promptTokenCount`, `cachedContentTokenCount` and `candidatesTokenCount` are normalized into canonical input, cached-input and output token usage. The configured catalog model remains the pricing key while the provider-reported response model is retained only as a hashed evidence reference.

A valid usage payload produces an `ACTUAL` CostEvent with provider response evidence hashed before persistence. FinOps never stores provider response content, tokens, credentials or arbitrary metadata.

If usage metadata is absent or malformed, the system does not invent a zero cost. It appends a `RECONCILIATION` gap marked by an opaque `MISSING_ACTUAL_USAGE` reference and preserves the model result. This exposes accounting drift without silently rewriting provider truth.

## Reconciliation

For valid actual usage, the runtime appends a `RECONCILIATION` CostEvent after `ACTUAL`. The first reconciliation layer classifies the result as:

- `WITHIN_ESTIMATE` when actual micro-USD is less than or equal to the pre-provider estimate;
- `OVER_ESTIMATE` when actual micro-USD exceeds the estimate;
- `MISSING_ESTIMATE` when actual usage exists without the expected pre-provider estimate;
- `MISSING_ACTUAL_USAGE` when the provider response lacks usable usage metadata.

These states are evidence only. They do not change budgets, models or provider behavior.

## Idempotency and evidence

Cost event IDs are deterministic within the cost execution scope. Provider response IDs and provider-reported model strings are hashed before entering the metadata allowlist. The underlying W-FINOPS-01 append-only ledger continues to detect identical replay versus conflicting event payloads.

Each physical AG-01 execute invocation receives a distinct cost execution ID while retaining the caller/logical correlation ID, so repeated physical model calls cannot be hidden inside one cost record.

## Safety boundary

W-FINOPS-02 performs no automatic model switching, no billing mutation, no campaign budget/spend mutation, no Meta/Instagram publication, no provider activation, no production deploy and no AG-01 recovery action.

The only provider call remains the pre-existing AG-01 Vertex decision call. The FinOps observer measures and records that call; it does not create another provider executor.

Future provider-invoice reconciliation (for example GCP Billing export) remains a separate stage. This version reconciles runtime estimate against provider usage/readback, not invoice settlement.