# Operation-scoped generative content-standard binding

Status: canonical implementation contract for PR #197.

## Rule

A generated static candidate can be finalized only when its effective operation-specific creative standard matches the current canonical `CONTENT_ITEMS.creative_standard_id` for the same `content_item_id`.

The caller may request a standard identity, but caller-supplied standard fields are not authority. `ControlledOperationScopedGenerativeFinalizationService` re-reads the requested ID from `CREATIVE_STANDARDS`, then independently reads `CONTENT_ITEMS!A1:BX2000` and resolves the `creative_standard_id` column by header name. Finalization fails closed if the canonical content row has no assigned standard, if the schema does not expose the required headers, if the content identity is ambiguous, or if the effective canonical standard disagrees with the content item.

For direct operation-specific outputs, the effective standard is the canonical requested output standard. For an `operation=ALL` transversal output, the effective standard is the canonical operation-specific visual standard. The latter must still equal `CONTENT_ITEMS.creative_standard_id`.

Failure boundaries:

- `FAILED_GENERATIVE_CONTENT_STANDARD_SCHEMA_INVALID` — the canonical content registry schema cannot resolve required headers safely;
- `FAILED_GENERATIVE_CONTENT_STANDARD_AMBIGUOUS` — more than one canonical row matches the content identity;
- `GENERATIVE_FINALIZATION_CONTENT_STANDARD_REQUIRED` — the content item has no canonical standard assigned;
- `GENERATIVE_FINALIZATION_CONTENT_STANDARD_MISMATCH` — the effective finalization standard differs from the content item standard.

## The Party

For `operation=THE_PARTY`, content-standard binding is necessary but not sufficient. The controlled finalizer also re-resolves same-item/same-edition The Party context through `GoogleSheetsThePartyContentOrchestration`. The effective standard must agree with that canonical context, and `THE_PARTY_HYBRID_NETWORKS_V1` additionally requires a resolved canonical environment. Caller-provided environment is forbidden.

## Sunset

For `operation=SUNSET`, the content item must explicitly carry the intended active canonical Sunset standard before a generative candidate can become final. Existing content items with a blank `creative_standard_id` remain fail-closed; no backfill is inferred merely to make a generated candidate pass.

## Release implication

This binding does not authorize publication. After finalization, Brand Integrity, Venue Fidelity, Quality, exact-output SHA-256 binding, approval/policy/capability gates, and provider-specific publication controls still apply. Provider-backed smoke must use a real canonical content item and a real approved operation-scoped exception; the system must not fabricate an approval or standard assignment for testing.
