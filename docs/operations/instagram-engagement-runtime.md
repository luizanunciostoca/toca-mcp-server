# Instagram Engagement Runtime

## Purpose

This runtime consumes persisted Meta/Instagram webhook events, classifies them under TOCA OS engagement policy, resolves only verified FAQ knowledge, records CRM/handoff state, and optionally executes one governed reply attempt for COMMENT or DIRECT events.

The runtime is fail-closed. `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true` starts durable processing, but external replies remain disabled while `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`.

## Canonical flow

1. Meta webhook signature is verified by the existing HTTP surface.
2. `PostgresMetaWebhookEventStore` persists a new event and enqueues `instagram.engagement.inbound.v1` in the same PostgreSQL transaction.
3. Duplicate webhook `event_id` values do not enqueue a second event.
4. The engagement worker claims only Instagram engagement event types.
5. Policy classification decides among low-risk auto-reply eligibility, suggestion, or human review.
6. FAQ knowledge is read from the configured Google Sheet and is usable for auto-reply only when the row is validated, has a source, has an official answer, has `AUTO_REPLY_ALLOWED`, matches the expected intent, and passes the confidence threshold.
7. Commercial leads reuse the canonical CRM social-engagement flow.
8. An eligible automatic reply becomes a separate `instagram.engagement.reply.v1` outbox event with `maxAttempts=1`.
9. A provider error with an ambiguous outcome is contained as `SEND_AMBIGUOUS`; the worker does not blindly retry the external write.

## Required schema

Apply the repository migrations before starting the worker. The engagement-specific migration is:

`035_instagram_engagement_e2e.sql`

The readiness preflight requires these tables:

- `meta_webhook_events`
- `event_outbox`
- `event_outbox_delivery_attempts`
- `instagram_engagement_actions`

## Required runtime configuration

Set environment values through the deployment control plane. Do not commit secret values.

Required for processing:

- `DATABASE_URL`
- `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true`
- `INSTAGRAM_ENGAGEMENT_TENANT_ID`
- optional `INSTAGRAM_ENGAGEMENT_WORKSPACE_ID` and `INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID`; each defaults to the tenant ID when omitted
- `INSTAGRAM_ENGAGEMENT_PAGE_ID`
- `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- `INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID`
- `INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE=gcp-iam` in production
- `INSTAGRAM_ENGAGEMENT_GOOGLE_SERVICE_ACCOUNT_EMAIL`

For local/test environments, `INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE=env` may be used with a short-lived token reference. Production must not depend on a manually maintained Google Sheets bearer token.

External writes additionally require:

- `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true`
- `META_ENABLED=true`
- `META_PROVIDER_VERIFIED=true`
- `META_ACCESS_TOKEN_ENV_KEY`
- the referenced Meta access-token environment secret to be present

The worker refuses to construct the live provider when Meta is not explicitly verified.

## Readiness gate

Run after migrations and secret injection, before starting the worker:

```bash
pnpm start:instagram-engagement-readiness
```

The preflight verifies:

- runtime configuration is complete;
- required PostgreSQL tables exist;
- migration 035 is recorded in `schema_migrations`;
- the FAQ sheet is readable;
- mandatory FAQ headers exist;
- when writes are enabled, Meta is explicitly verified and a read-only Graph API identity request succeeds.

The preflight prints only a sanitized PASS record and never prints account IDs, sheet IDs, tokens, user identities, or message text.

## Production shadow topology

The canonical production shadow topology reuses existing TOCA OS surfaces rather than creating a parallel system:

- `toca-webhook-next-production` receives `GET/POST /webhooks/meta`, validates Meta challenge/signature, persists inbound COMMENT/DIRECT events and enqueues them in PostgreSQL.
- `toca-managed-instagram-daemon` remains the authenticated, scale-to-zero minute-trigger service. Its `/tick` processes both the existing publication batch and the bounded engagement batch when `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true`.
- In shadow mode, `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false` on every runtime surface. Verified low-risk facts are classified/suggested only; no external COMMENT or DIRECT reply is sent.
- The FAQ source is `TOCA_OS — BASE_CANONICA_ATENDIMENTO_INSTAGRAM_IA_v1.0`; the historical 2025 analysis sheet is superseded and is not a runtime source.

## Promotion sequence

### Stage A — code and schema

- Required CI contexts green on the exact candidate SHA.
- Apply migrations.
- Run the readiness preflight with writes disabled.

### Stage B — shadow processing

Set:

- `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true`
- `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`

Keep Meta webhook persistence enabled on the canonical HTTP service. Confirm new events progress through classification/CRM and that no reply event can perform an external write.

### Stage C — controlled write readiness

Before enabling replies, require all of the following evidence:

- Meta provider verified for the canonical app/account binding;
- COMMENT and DIRECT permissions verified for the intended users;
- FAQ rows intended for automation are individually validated and sourced;
- high-risk and unknown intents route to human review;
- `SEND_AMBIGUOUS` has an operational human-resolution path;
- monitoring queries below show no unexpected backlog or dead letters.

Only then may a separate authorized change set `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true`.

## Rollback

Fast write stop:

1. Set `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`.
2. Keep the worker running if read/classify/CRM processing should continue.

Full engagement stop:

1. Set `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`.
2. Set `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=false` and stop engagement processing in the daemon.
3. Keep webhook persistence enabled unless inbound capture itself must be stopped.

Do not delete outbox or action rows during rollback. They are the audit/recovery record.

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

## Historical 2025 Directs

Historical 2025 Direct recovery is explicitly out of scope for the current operational runtime. The runtime starts from newly captured webhook traffic and must not claim historical completeness. The superseded 2025 analysis artifact is not consulted for live replies.
