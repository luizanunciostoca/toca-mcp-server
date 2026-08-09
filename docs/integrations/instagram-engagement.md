# Instagram Engagement — preconnection design

Status: IMPLEMENTED IN CODE / NOT CONNECTED / NOT EXPOSED TO CHATGPT

This domain covers comments, Direct messaging, private replies when eligible, webhook ingestion, classification, escalation and audited responses.

## Architecture

Instagram -> Meta webhook/read APIs -> TOCA MCP -> ChatGPT + TOCA_OS -> engagement policy -> explicit MCP reply tool -> Meta API.

The TOCA MCP does not create an internal chatbot. ChatGPT remains the reasoning/orchestration layer. The server validates capability, policy, idempotency and audit boundaries.

## Planned capabilities

- `instagram.comments.read`
- `instagram.comments.reply`
- `instagram.messaging.conversations.read`
- `instagram.messaging.messages.read`
- `instagram.messaging.reply`
- `instagram.messaging.private_reply`
- `instagram.engagement.webhook.receive`

None of these are available merely because code exists. They remain hidden from the runtime registry until real Meta evidence, scopes, account eligibility and production validation are complete.

## Permissions

The exact permission set is resolved from the selected Meta integration mode and current API version. Current Meta documentation for Instagram Login identifies `instagram_business_manage_messages` and `instagram_business_manage_comments` for messaging/comments. The code also accepts the corresponding Facebook Login permission names where applicable. Provider evidence remains mandatory in addition to scope presence.

## Autonomy

- READ_ONLY: inspect/classify only.
- SUGGEST_ONLY: draft response; human approval required.
- AUTO_REPLY_ALLOWED: only verified low-risk facts after production validation.
- HUMAN_REVIEW_REQUIRED: complaint, refund, legal, safety, press, public figure, threat/harassment, sensitive data or other high-risk scenarios.

## Webhooks

Webhook events are data inputs, never authority to reply. Events must be authenticated according to Meta's current webhook requirements, deduplicated, classified, correlated and audited before any side effect.

## Production gate

Auto-reply remains disabled until real Meta connection, webhook validation, send/reply tests, idempotency, audit, kill switch and runbook are all proven and capabilities are marked `PRODUCTION_VALIDATED` in TOCA_OS.
