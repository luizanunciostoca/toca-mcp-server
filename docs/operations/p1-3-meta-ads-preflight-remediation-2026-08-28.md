# P1.3 — Meta Ads provider preflight remediation

Date: 2026-08-28
Base snapshot: `b1d838a6b3efe35b7df3afb6b53c4a9b42f7712a`
Observed provider failure: `META_HTTP_400 | META_CODE_100 | META_SUBCODE_1860014`

## Safety conclusion

The exact-head PREPARE run `33148557216` failed before any external mutation. `providerMutationExecuted=false`; the EXECUTE phase was skipped.

## Remediation objective

The no-side-effect provider preflight must not assume the first usable existing Ad Set is compatible with the selected creative. It now iterates through usable existing Ad Sets and uses Meta `validate_only` until a compatible pair is found or all eligible candidates are exhausted.

## Invariants

- PREPARE remains no-side-effect.
- `execution_options=["validate_only"]` remains mandatory.
- An unexpected returned Ad ID remains a hard failure.
- No campaign activation is introduced.
- Public MCP Meta Ads writes remain disabled.
- EXECUTE continues to require the immutable PREPARE descriptor and explicit approval.
- If every eligible Ad Set is rejected by Meta, the last provider error is preserved and the workflow fails closed.

## Validation requirement

Run the normal quality gate on this remediation branch. After CI is green, run `Meta Ads CREATE_PAUSED Provider Validation` with `phase=PREPARE` on the remediation branch. Only a successful PREPARE may advance to explicit approval and EXECUTE.
