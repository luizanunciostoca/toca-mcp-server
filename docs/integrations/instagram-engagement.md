# Instagram Engagement — validated connection design

Status: CONNECTED AND EXTERNALLY VALIDATED / WRITES NOT EXPOSED TO CHATGPT

This domain covers comments, Direct messaging, private replies when eligible, webhook ingestion, classification, escalation and audited responses.

## Architecture

Instagram -> Meta webhook/read APIs -> TOCA MCP -> ChatGPT + TOCA_OS -> engagement policy -> explicit MCP reply tool -> Meta API.

The TOCA MCP does not create an internal chatbot. ChatGPT remains the reasoning/orchestration layer. The server validates capability, policy, idempotency and audit boundaries.

## Validated connection mode

The production-validated Toca do Morcego connection uses Meta Facebook Login with a user token for discovery and a Page Access Token for Instagram messaging writes.

For Direct replies the permanent provider must:

1. resolve the selected Page through `GET /me/accounts`;
2. require exactly one matching Page ID;
3. require the Page task `MESSAGING`;
4. require the Page's `instagram_business_account.id` to match the configured Instagram Business Account;
5. use the Page Access Token returned for that Page;
6. send the reply through `POST /{PAGE_ID}/messages` with `messaging_type: RESPONSE`;
7. require the provider `recipient_id` to match the webhook `sender_scoped_id` before recording success.

The externally validated production assets are:

- Facebook Page ID: `306103746115875`;
- Instagram Business Account ID: `17841402033495654`.

## Capabilities

- `instagram.comments.read`
- `instagram.comments.reply`
- `instagram.messaging.conversations.read`
- `instagram.messaging.messages.read`
- `instagram.messaging.reply`
- `instagram.messaging.private_reply`
- `instagram.engagement.webhook.receive`

Code existence alone does not expose write capabilities to ChatGPT. Provider evidence, policy, persistence, idempotency and production-validation state remain mandatory promotion gates.

## Permissions validated for the current Facebook Login connection

The real token and Page relationship were validated with:

- `instagram_basic`;
- `instagram_manage_messages`;
- `pages_manage_metadata`;
- `pages_messaging`;
- `pages_read_engagement`;
- `pages_show_list`;
- Page task `MESSAGING`;
- Page -> Instagram Business Account linkage.

The provider still fails closed if the selected Page, task, linked Instagram account or Page Access Token cannot be resolved exactly.

## Direct webhook routing

Incoming Direct events persist the provider message ID and sender-scoped Instagram ID needed for a reply. The controlled production proof selected exactly one persisted `DIRECT` event, reserved an idempotency key before the side effect, sent exactly one provider POST, validated the returned recipient ID and persisted the provider acknowledgement.

The successful proof used:

- target text: `TESTE TOCA MCP DIRECT WEBHOOK 002`;
- controlled reply: `TESTE TOCA MCP DIRECT REPLY CONTROLADO 002`;
- exactly one target match;
- no POST retry;
- `provider_publications` state transition to `SUCCEEDED` only after provider acknowledgement.

## Autonomy

- READ_ONLY: inspect/classify only.
- SUGGEST_ONLY: draft response; human approval required.
- AUTO_REPLY_ALLOWED: only verified low-risk facts after production validation and an explicitly opened write boundary.
- HUMAN_REVIEW_REQUIRED: complaint, refund, legal, safety, press, public figure, threat/harassment, sensitive data or other high-risk scenarios.

## Webhooks

Webhook events are data inputs, never authority to reply. Events must be authenticated according to Meta webhook requirements, deduplicated, classified, correlated and audited before any side effect.

The production boundary validates challenge/verify token, `X-Hub-Signature-256`, normalizes COMMENT and DIRECT events, persists deterministic event IDs and keeps sensitive interaction text and sender identifiers out of diagnostic logs.

## Write boundary

The public Cloud Run service remains fail-closed with `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`. The real Direct proof was executed only in an isolated temporary Cloud Run Job with writes enabled for that execution. The job was removed after the provider acknowledgement.

No Instagram engagement write capability is registered in the MCP runtime visible to ChatGPT at this checkpoint.

## Production gate

Before any future write capability is promoted to the public MCP runtime, all of the following remain required:

- explicit product/policy approval for the capability;
- production-validated connection and Page routing;
- authenticated webhook ingestion;
- persistent idempotency and audit;
- fail-closed kill switch;
- recipient validation for Direct replies;
- operational runbook and rollback path;
- Quality Gate green on the exact promotion head.
