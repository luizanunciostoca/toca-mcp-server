# Instagram Engagement Runtime

## Purpose

This runtime consumes persisted Meta/Instagram webhook events, classifies them under TOCA OS engagement policy, resolves only verified FAQ knowledge, records CRM/handoff state, and optionally executes one governed reply attempt for COMMENT or DIRECT events.

The runtime is fail-closed. `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true` activates durable processing, but external replies remain disabled while `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`.

Historical Direct recovery is not a runtime dependency and is out of scope for this operating path.

## Canonical production topology

The engagement runtime reuses existing TOCA MCP infrastructure:

1. Public controlled webhook service: `toca-webhook-next-production`, `TOCA_SERVICE_ROLE=webhook`.
2. Webhook route: `/webhooks/meta` on the existing HTTP runtime.
3. PostgreSQL/Cloud SQL: the canonical TOCA MCP production database.
4. Transactional outbox: `event_outbox`.
5. Processor: the existing `toca-managed-instagram-daemon` minute-triggered, scale-to-zero daemon; each `/tick` processes publication work and one bounded engagement batch.
6. Knowledge source: `TOCA_OS — BASE_CANONICA_ATENDIMENTO_INSTAGRAM_IA_v1.0`, spreadsheet ID `1M0HSs7QJpFCJvvnrZxJRaaXY8scv5R3okCG_OyFLiEU`, range `FAQ_IA!A:T`.
7. Google Sheets authorization in production: runtime service-account identity + IAM Credentials scoped token for `spreadsheets.readonly`; no service-account JSON key and no long-lived Google bearer token.

The current canonical scope is:

- tenant: `toca`
- workspace: `toca`
- organization: `toca`
- Facebook Page ID: `306103746115875`
- Instagram Business Account ID: `17841402033495654`

## Canonical flow

1. Meta webhook challenge/signature is verified by the existing HTTP surface.
2. `PostgresMetaWebhookEventStore` persists a new event and enqueues `instagram.engagement.inbound.v1` in the same PostgreSQL transaction.
3. Duplicate webhook `event_id` values do not enqueue a second event.
4. The managed Instagram daemon claims only Instagram engagement event types during its bounded tick.
5. Policy classification decides among low-risk auto-reply eligibility, suggestion, or human review.
6. FAQ knowledge is usable for auto-reply only when the row is approved, has a source, has an official answer, has `AUTO_REPLY_ALLOWED`, matches the expected intent, and passes the confidence threshold.
7. Commercial leads reuse the canonical CRM social-engagement flow.
8. An eligible automatic reply becomes a separate `instagram.engagement.reply.v1` outbox event with `maxAttempts=1`.
9. While writes are disabled, the decision/audit path remains active but no external provider send is authorized.
10. A provider error with an ambiguous outcome is contained as `SEND_AMBIGUOUS`; the runtime does not blindly retry the external write.

## Required schema

Apply repository migrations before activation. The engagement-specific migration is:

`035_instagram_engagement_e2e.sql`

The readiness preflight requires:

- `meta_webhook_events`
- `event_outbox`
- `event_outbox_delivery_attempts`
- `instagram_engagement_actions`

## Google Sheets production authorization

The spreadsheet is shared read-only with:

`toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`

Required Google APIs:

- `iamcredentials.googleapis.com`
- `sheets.googleapis.com`

The runtime service account requires `roles/iam.serviceAccountTokenCreator` on itself so it can exchange its Cloud Run metadata identity for a short-lived token restricted to:

`https://www.googleapis.com/auth/spreadsheets.readonly`

Production configuration:

- `INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE=gcp-iam`
- `INSTAGRAM_ENGAGEMENT_GOOGLE_SERVICE_ACCOUNT_EMAIL=toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`

`env` auth remains supported for local/test use only.

## Required runtime configuration

Set values through the deployment control plane. Do not commit secret values.

Shadow processing requires:

- `DATABASE_URL`
- `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true`
- `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`
- `INSTAGRAM_ENGAGEMENT_TENANT_ID=toca`
- `INSTAGRAM_ENGAGEMENT_WORKSPACE_ID=toca`
- `INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID=toca`
- `INSTAGRAM_ENGAGEMENT_PAGE_ID=306103746115875`
- `INSTAGRAM_BUSINESS_ACCOUNT_ID=17841402033495654`
- `INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID=1M0HSs7QJpFCJvvnrZxJRaaXY8scv5R3okCG_OyFLiEU`
- `INSTAGRAM_ENGAGEMENT_KNOWLEDGE_RANGE=FAQ_IA!A:T`
- `INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE=gcp-iam`
- `INSTAGRAM_ENGAGEMENT_GOOGLE_SERVICE_ACCOUNT_EMAIL=toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`

Webhook service additionally requires:

- `META_WEBHOOK_ENABLED=true`
- `META_WEBHOOK_PERSISTENCE_ENABLED=true`
- Meta app secret and verify-token secret bindings already used by the canonical webhook service

External writes additionally require a separate authorized change with:

- `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true`
- `META_ENABLED=true`
- `META_PROVIDER_VERIFIED=true`
- `META_ACCESS_TOKEN_ENV_KEY`
- the referenced Meta access token present

The live provider cannot be constructed unless Meta is explicitly verified.

## Readiness gate

Run after migration/IAM/API setup and before shadow activation:

```bash
pnpm start:instagram-engagement-readiness
```

With writes disabled, the preflight verifies:

- runtime configuration is complete;
- required PostgreSQL tables exist;
- migration 035 is recorded in `schema_migrations`;
- the operational FAQ sheet is readable using the configured production auth mode;
- mandatory FAQ headers exist.

With writes enabled it additionally requires Meta verification and a read-only Graph identity check.

The preflight emits sanitized evidence only; it does not print user identities, message text or secret material.

## Promotion sequence

### Stage A — code and schema

- Required CI contexts green on the exact candidate SHA.
- Apply migration 035.
- Enable required Google APIs and self Token Creator IAM.
- Run readiness with writes disabled.

### Stage B — production shadow

Set on the webhook service:

- `META_WEBHOOK_ENABLED=true`
- `META_WEBHOOK_PERSISTENCE_ENABLED=true`
- `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true`
- canonical engagement scope values

Set on the managed daemon:

- `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true`
- `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`
- canonical FAQ and Google Sheets auth values

Confirm:

- webhook challenge/signature works;
- a new COMMENT or DIRECT event creates exactly one inbound outbox event;
- the next daemon tick claims and classifies the event;
- an action/audit decision is stored;
- low-risk eligible content can resolve the approved FAQ;
- high-risk/unknown content remains human-controlled;
- no external comment/Direct reply is sent.

### Stage C — controlled write readiness

Before enabling customer-facing replies, require all of:

- Meta provider verified for the canonical app/account binding;
- COMMENT and DIRECT permissions verified for the intended users;
- FAQ rows intended for automation individually approved and sourced;
- high-risk and unknown intents route to human review;
- `SEND_AMBIGUOUS` has an operator resolution path;
- monitoring shows no unexplained backlog/dead letters;
- an explicit production authorization for engagement writes on the exact candidate SHA.

Only Stage C may set `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true`.

## Rollback

Fast write stop:

1. Set `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`.
2. Keep runtime/webhook active if read/classify/CRM processing should continue.

Full engagement stop:

1. Set `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`.
2. Set `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=false` on the managed daemon.
3. Set `META_WEBHOOK_PERSISTENCE_ENABLED=false` if inbound capture itself must stop.
4. Leave audit/outbox/action rows intact.

If ingress itself must be closed, set `META_WEBHOOK_ENABLED=false` or roll the webhook service back to the last known-good revision.

## Operational queries

Backlog by state:

```sql
select event_type, status, count(*)
from event_outbox
where event_type in ('instagram.engagement.inbound.v1', 'instagram.engagement.reply.v1')
group by event_type, status
order by event_type, status;
```

Engagement decisions:

```sql
select status, risk, autonomy, count(*)
from instagram_engagement_actions
group by status, risk, autonomy
order by status, risk, autonomy;
```

Ambiguous provider outcomes:

```sql
select count(*)
from instagram_engagement_actions
where status = 'SEND_AMBIGUOUS';
```

Stale claimed Instagram work:

```sql
select event_type, count(*)
from event_outbox
where event_type in ('instagram.engagement.inbound.v1', 'instagram.engagement.reply.v1')
  and status = 'CLAIMED'
  and claimed_at < now() - interval '5 minutes'
group by event_type;
```

## Historical datasets

Historical 2025 Direct recovery is not required for this runtime. The previous `PENDING_2025` spreadsheet was superseded and must not be used as the operational knowledge source. The current operational source is `TOCA_OS — BASE_CANONICA_ATENDIMENTO_INSTAGRAM_IA_v1.0`.