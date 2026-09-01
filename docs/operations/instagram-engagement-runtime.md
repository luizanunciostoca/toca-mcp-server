# Instagram Engagement Runtime

## Purpose

This runtime consumes persisted Meta/Instagram webhook events, classifies them under TOCA OS engagement policy, resolves verified knowledge, records CRM/handoff state, and optionally executes one governed reply attempt for COMMENT or DIRECT events.

The runtime is fail-closed. `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true` starts durable processing, but external replies remain disabled while `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`.

## Canonical knowledge architecture

TOCA OS remains the institutional source of truth. Runtime knowledge is a bounded operational mirror and never gains authority merely because retrieval found a similar passage.

Resolution precedence is:

1. canonical FAQ mirror (`instagram_engagement_knowledge`), which is the deterministic fast lane;
2. sanitized TOCA OS Knowledge Base (`instagram_engagement_knowledge_documents` + `instagram_engagement_knowledge_chunks`) only when FAQ resolution returns no match;
3. suggestion/human review when no safe verified fact is available.

The broader Knowledge Base is not a free-form RAG over Google Drive. The sync reads only source IDs allowlisted in the canonical `FONTES_CANONICAS` registry and transforms them with deterministic extractors. The initial allowlist is:

- `SRC-OPS-001` — canonical operating parameters: hours, official channels, contact and variable ticket-price policy;
- `SRC-MENU-002` — active rows from the structured canonical menu;
- `SRC-LOC-001` — stable location only. Historical event or price content in that broader document is deliberately ignored.

Policy documents are governance inputs, not response content. Superseded/legacy registry rows are not ingested. Commercial leads, complaints, refunds, legal, safety incidents, press/public-figure cases, harassment/threats and unknown intents do not use the Knowledge Base auto-reply path.

A Knowledge Base hit is considered `factsVerified=true` only when its chunk is `LOW` risk and explicitly `AUTO_REPLY_ALLOWED`. `SUGGEST_ONLY` retrieval can never promote itself to executable authority.

Every action records knowledge provenance: `knowledge_tier` (`FAQ` or `KNOWLEDGE_BASE`) plus the optional `knowledge_chunk_id`.

## Canonical flow

1. Meta webhook signature is verified by the existing HTTP surface.
2. `PostgresMetaWebhookEventStore` persists a new event and enqueues `instagram.engagement.inbound.v1` in the same PostgreSQL transaction.
3. Duplicate webhook `event_id` values do not enqueue a second event.
4. The engagement worker claims only Instagram engagement event types.
5. Policy classification decides among low-risk auto-reply eligibility, suggestion, or human review.
6. FAQ resolution runs first. With tiered knowledge enabled, the bounded PostgreSQL Knowledge Base is consulted only after an FAQ miss.
7. Commercial leads reuse the canonical CRM social-engagement flow and do not get authority from Knowledge Base retrieval.
8. An eligible automatic reply becomes a separate `instagram.engagement.reply.v1` outbox event with `maxAttempts=1`.
9. A provider error with an ambiguous outcome is contained as `SEND_AMBIGUOUS`; the worker does not blindly retry the external write.

## Required schema

Apply repository migrations before starting the worker:

- `035_instagram_engagement_e2e.sql` — engagement persistence;
- `036_instagram_engagement_knowledge.sql` — canonical FAQ PostgreSQL mirror;
- `037_instagram_engagement_tiered_knowledge.sql` — tiered TOCA OS Knowledge Base and provenance columns.

Migration 037 is required only when `INSTAGRAM_ENGAGEMENT_KNOWLEDGE_BASE_ENABLED=true`.

## Knowledge synchronization

Production should use PostgreSQL as the runtime read model and synchronize it from canonical TOCA OS sources through the governed read-only job:

```bash
pnpm start:sync-instagram-engagement-knowledge-base
```

The sync performs these checks before commit:

- spreadsheet ID must equal the canonical TOCA OS engagement spreadsheet;
- each configured source ID must exist in `FONTES_CANONICAS` with an accepted canonical/active status;
- Drive access is read-only;
- each source is hashed before deriving chunks;
- old chunks for the same document are deactivated before the new snapshot is upserted;
- document count, chunk count and safe auto-reply chunk count must pass validation;
- raw private messages are never used as a knowledge source and source content is not printed to logs.

Recommended production authentication is GCP IAM with readonly Google Sheets and Google Drive scopes.

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

For the tiered production read model set:

- `INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SOURCE=postgres`
- `INSTAGRAM_ENGAGEMENT_KNOWLEDGE_BASE_ENABLED=true`
- `INSTAGRAM_ENGAGEMENT_KB_SOURCE_IDS=SRC-OPS-001,SRC-MENU-002,SRC-LOC-001`
- `INSTAGRAM_ENGAGEMENT_KB_MIN_CONFIDENCE=0.58` unless a separately validated threshold supersedes it
- `INSTAGRAM_ENGAGEMENT_KB_CANDIDATE_LIMIT=12`
- `INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE=gcp-iam` for synchronization
- `INSTAGRAM_ENGAGEMENT_GOOGLE_SERVICE_ACCOUNT_EMAIL`

For local/test environments, Google Sheets direct FAQ mode and short-lived env token references remain available.

External writes additionally require:

- `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true`
- `META_ENABLED=true`
- `META_PROVIDER_VERIFIED=true`
- `META_ACCESS_TOKEN_ENV_KEY`
- the referenced Meta access-token environment secret to be present

The worker refuses to construct the live provider when Meta is not explicitly verified.

## Readiness gate

Run after migrations and knowledge synchronization, before starting the worker:

```bash
pnpm start:instagram-engagement-readiness
```

The preflight verifies runtime configuration, required PostgreSQL tables/migrations, exact canonical FAQ snapshot, configured Knowledge Base source set, safe active chunks and — only when writes are enabled — a read-only Meta provider identity call.

When tiered knowledge is enabled, a missing migration, missing source, missing safe chunk, stale/incomplete source set or schema mismatch fails readiness closed.

The preflight prints only sanitized PASS metadata and never prints account IDs, sheet IDs, tokens, user identities, message text or source content.

## Production shadow topology

The canonical production shadow topology reuses existing TOCA OS surfaces rather than creating a parallel system:

- `toca-webhook-next-production` receives `GET/POST /webhooks/meta`, validates Meta challenge/signature, persists inbound COMMENT/DIRECT events and enqueues them in PostgreSQL.
- `toca-managed-instagram-daemon` remains the authenticated, scale-to-zero minute-trigger service. Its `/tick` processes both the existing publication batch and the bounded engagement batch when `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true`.
- In shadow mode, `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false` on every runtime surface. Verified low-risk facts are classified/suggested only; no external COMMENT or DIRECT reply is sent.
- The FAQ source is `TOCA_OS — BASE_CANONICA_ATENDIMENTO_INSTAGRAM_IA_v1.0`; historical/superseded analysis artifacts are not runtime sources.

## Promotion sequence

### Stage A — code and schema

- Required CI contexts green on the exact candidate SHA.
- Apply migrations through a separately authorized production change.
- Synchronize canonical Knowledge Base sources.
- Run readiness with writes disabled.

### Stage B — shadow processing

Set:

- `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true`
- `INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SOURCE=postgres`
- `INSTAGRAM_ENGAGEMENT_KNOWLEDGE_BASE_ENABLED=true`
- `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`

Run the synthetic COMMENT + DIRECT shadow proof and additional Knowledge Base cases. Require provenance, zero external writes and full prestate restoration.

### Stage C — controlled write readiness

Before enabling replies, require Meta provider verification, required COMMENT/DIRECT permissions, individually sourced auto-reply facts, human routing for sensitive/unknown intents, an operational path for `SEND_AMBIGUOUS`, and clean backlog/dead-letter monitoring.

Only a separate authorized change may set `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true`.

## Rollback

Fast write stop:

1. Set `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`.
2. Keep the worker running if read/classify/CRM processing should continue.

Knowledge fallback stop:

1. Set `INSTAGRAM_ENGAGEMENT_KNOWLEDGE_BASE_ENABLED=false`.
2. Keep `INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SOURCE=postgres` to continue using the canonical FAQ mirror.

Full engagement stop:

1. Set `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`.
2. Set `INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=false` and stop engagement processing in the daemon.
3. Keep webhook persistence enabled unless inbound capture itself must be stopped.

Do not delete outbox, action, FAQ or Knowledge Base provenance rows during rollback; they are audit/recovery evidence.

## Operational queries

Backlog by state:

```sql
select event_type, status, count(*)
from event_outbox
where event_type in ('instagram.engagement.inbound.v1', 'instagram.engagement.reply.v1')
group by event_type, status
order by event_type, status;
```

Engagement decisions and source tier:

```sql
select status, risk, autonomy, knowledge_tier, count(*)
from instagram_engagement_actions
group by status, risk, autonomy, knowledge_tier
order by status, risk, autonomy, knowledge_tier;
```

Active Knowledge Base inventory:

```sql
select d.source_id, c.risk, c.autonomy, count(*)
from instagram_engagement_knowledge_documents d
join instagram_engagement_knowledge_chunks c on c.document_id = d.document_id
where d.active = true and c.active = true
group by d.source_id, c.risk, c.autonomy
order by d.source_id, c.risk, c.autonomy;
```

Ambiguous provider outcomes:

```sql
select count(*)
from instagram_engagement_actions
where status = 'SEND_AMBIGUOUS';
```

## Historical Directs

Historical Direct recovery is explicitly out of scope for the operational response Knowledge Base. Raw customer conversations are not promoted into authoritative knowledge. Learning from conversations requires a separate governed curation/promotion process before any information becomes an approved TOCA OS fact.
