# Preconnection implementation roadmap

This stacked branch prepares later phases without claiming external connectivity.

## Implemented contracts

- Instagram account/profile/media/comments/insights read boundary.
- Instagram publish/status/comment-reply write boundary.
- Instagram capability discovery from positive provider evidence only.
- Scheduler/job/reconciliation contracts.
- Meta Ads Campaign/Ad Set/Creative/Ad/Insights boundaries.
- Financial budget guardrail evaluation.

## Runtime rule

None of these provider capabilities are registered in the MCP Tool Registry on this branch. The ChatGPT-visible runtime remains limited to the Phase 1 system tools until real Meta validation has passed and the corresponding capability is intentionally promoted.

## Promotion sequence

1. Phase 1 real Meta + ChatGPT connection proof.
2. Promote proven Instagram read capabilities.
3. Validate provider HTTP adapters against the connected account.
4. Add write tools only in dedicated write PRs with policy/audit/idempotency.
5. Add scheduler-backed publication only after direct publishing is proven.
6. Add Meta Ads read, then writes, with official TOCA_OS financial policy loaded into runtime configuration.

## No secret rule

Mocks/contracts may use fake identifiers only. No Meta token, App Secret, Page token, ad-account secret or real credential is permitted in this branch.
