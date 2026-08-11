# Instagram history real-provider checkpoint — 2026-08-11

Validation branch only. No production business logic is introduced here.

## Confirmed

- Official Instagram Business Account ID: `17841402033495654` (`@tocadomorcego`).
- `InstagramHistoryProvider.listMedia()` executed under `toca-mcp-runtime` using the token from Secret Manager.
- `instagram_basic` is granted.
- `media.list` returned real provider data (`returnedMedia=3`) and the Cloud Run job completed successfully.
- `instagram_manage_insights` is **not granted** on the current token.
- Media/account insight calls therefore remain blocked as `SCOPE_NOT_GRANTED`.
- No external write was executed.

## Next gate

Request `instagram_manage_insights` through the isolated Meta OAuth boundary, reauthorize the official account, then rerun real provider smoke for `instagram.insights.media` and `instagram.insights.account` before promoting either capability to CONNECTED.
