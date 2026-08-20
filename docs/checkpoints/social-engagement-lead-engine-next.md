# Social Engagement → Lead Engine — Next Version checkpoint

Status: IMPLEMENTED / CI EVIDENCE PENDING

Feature coordination identity: `NEXT-015 — Social Engagement R30 to CRM`.

## Baseline

- branch created from `main@cd99521c8842268c5e1fb9e5efe58f9f6680ddf0` after live readback;
- frozen V1 production identity remains `abfb09b17e90c83790e803dcda091c8142c7407f` and `PRODUCTION_VERIFIED`;
- historical `feat/instagram-engagement-messaging` is 499 commits behind current main and was not used as a merge source.

## Reused architecture

This implementation does not create an inbox, CRM, MCP, scheduler, Approval Engine, Policy Engine or database.

It reuses:

- authenticated Meta webhook normalization;
- existing `meta_webhook_events` deterministic idempotency and audit persistence;
- existing engagement policy (`evaluateEngagementPolicy`);
- existing CRM `ContactRecord` / `LeadRecord` contracts and `CrmCoreStore`;
- existing CRM mutation idempotency, revision, audit and transactional outbox implemented by `PostgresCrmCoreStore`;
- canonical `EventRecord` / `EventRecordStore` for Sunset/The Party event linkage.

`EventRecord` remains the real commercial event master record. A social message is **not** stored as an `EventRecord`. The lead links to the resolved event through the existing `LeadRecord.eventId` field.

## Implemented pipeline

`COMMENT / DIRECT / MENTION / REPLY`
→ normalized social interaction
→ sender-scoped contact resolution
→ deterministic classification
→ canonical EventRecord resolution when unambiguous
→ create/reuse LeadRecord
→ NextAction in CRM lead attributes
→ existing CRM audit/outbox path.

Classifications persisted without raw interaction text:

- intent;
- commercial intent;
- Sunset/The Party interest;
- sentiment;
- urgency;
- topic;
- language;
- product/event;
- next action;
- human-required flag;
- opaque source/event references.

## Duplicate prevention

- webhook retries remain deduplicated by the existing deterministic Meta `event_id` persistence boundary;
- contact IDs and channel IDs are deterministic from scope + provider-scoped sender identity;
- lead IDs are deterministic from scope + social lead key;
- active lead lookup is performed before creation;
- replay of the same engagement event returns the current lead without creating a second lead or revision.

## Reply safety

This engine never calls a provider write method.

Automatic reply eligibility requires all applicable gates:

1. existing engagement policy returns `AUTO_REPLY_ALLOWED`;
2. facts are verified;
3. write kill switch is enabled;
4. communication consent is allowed;
5. approval is satisfied when required.

Otherwise the result is `SUGGEST_ONLY`, `NO_REPLY`, or `HUMAN_REQUIRED`.

Complaint, refund, legal, safety, press, threat/harassment, sensitive-data and critical-urgency paths fail closed to human handling through the existing engagement policy plus the engine's critical-urgency guard.

## Meta normalization

The existing persisted channel contract remains `COMMENT | DIRECT`; no migration is required. Mention events are normalized as public `COMMENT` channel with `rawType=mentions`, while public replies remain `COMMENT` with `rawType=<field>:reply`. The lead engine derives the higher-level interaction kind from `rawType` without changing migration `003_meta_webhook_idempotency.sql`.

## Dependencies and integration boundary

The central Next Version registry declares `NEXT-015` dependencies on:

- `NEXT-008` CRM and Sales Engine expansion;
- `NEXT-010` Conversation and Message records;
- `NEXT-016` Privacy / LGPD expansion.

The current branch intentionally does not copy or stack on parallel implementations. Runtime activation should occur only after those dependencies are merged/revalidated, so Conversation/Message ownership and canonical privacy authorization can be wired without parallel abstractions.

At this checkpoint the core handoff is implemented and tested, but no production provider write is executed and no provider evidence state is promoted by this branch.
