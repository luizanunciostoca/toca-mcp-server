# Google Business Profile / Local Discovery / Reputation

Status: **IMPLEMENTED ARCHITECTURE — NOT CONNECTED / NOT PRODUCTION VALIDATED**

Base `main` SHA: `76aec57a707161f4ca8484059b8ec302b9be6910`

Scope: existing routes **R07 / R30 / R31** only. No R33.

## Objective

Create a safe TOCA OS foundation for local discovery, Google event posts, reputation handling,
profile freshness and local performance while keeping public writes behind the existing R27
approval lifecycle and mandatory provider read-back.

## Subflows

- R07: `LOCAL_DISCOVERY`, `GOOGLE_EVENT_POST`, `PROFILE_FRESHNESS`
- R30: `REVIEW_RESPONSE`
- R31: `LOCAL_PERFORMANCE`

## Capabilities

R07 receives:

- `google_business.location.read`
- `google_business.location.validate`
- `google_business.hours.reconcile`
- `google_business.post.prepare`
- `google_business.post.create`
- `google_business.post.readback`
- `google_business.profile.drift.detect`

R30 receives:

- `google_business.review.ingest`
- `google_business.review.classify`
- `google_business.review.reply_draft`
- `google_business.review.reply`
- `google_business.review.verify`
- `google_business.notification.ingest`

R31 receives:

- `google_business.performance.read`

The additions extend the catalog from 731 to 745 compatibility IDs and from 723 to 737 effective
semantic capabilities. The route count remains exactly 32 and the eight existing compatibility
aliases are unchanged.

## Provider boundary

`src/local-discovery/google-business.ts` defines a provider-neutral Google Business contract for:

- Business Information location read and Google-updated-location read;
- Local Post create/read-back;
- review list/get/update-reply;
- Business Profile Performance reads.

The provider interface deliberately exposes **no location/profile/hours mutation**. Hours
reconciliation and profile drift detection produce evidence/diffs only.

Current Google Business capabilities are code-backed `IMPLEMENTED` internal-engine contracts. They
are intentionally **not** registered as MCP runtime tools and are not `CONNECTED` or
`PRODUCTION_VALIDATED`.

## Public-write governance

Only these operations are public provider writes in this scope:

1. `google_business.post.create`
2. `google_business.review.reply`

Both are `WRITE_EXTERNAL`, require formal approval, and route execution through the existing
`executeTool` R27 atomic approval flow. That flow reserves the ApprovalRecord, starts execution,
performs provider write, performs provider read-back, persists read-back evidence, then consumes the
approval. Ambiguous provider state fails closed into review-required state and automatic retry is
blocked.

The Google Business write tool definitions remain lifecycle `IMPLEMENTED`, so core policy denies
provider side effects until a separate evidence-backed lifecycle promotion occurs.

## Review safety

Review replies are draft-first. `autoReplyEligible` is always false and every public reply requires
R27 approval.

The deterministic classification layer treats at least the following as human-review-required:

- complaints / low ratings;
- legal or regulatory language;
- safety, violence, harassment, accident or other crisis indicators.

Sensitive replies cannot enter the governed provider-write path without reviewer identity and
human-review evidence. No unrestricted auto-reply path is introduced.

CRM integration is not implemented here. Classification records only a
`DEFERRED_UNTIL_CRM_CORE_AVAILABLE` future handoff marker so this branch does not import or create CRM
core records.

## EventRecord reuse

`google_business.post.prepare` can bind to the canonical `EventRecord` and derives event title,
start/end and timezone from that record instead of creating a second event master.

After a governed post write succeeds and provider read-back verifies the expected post, the service
attaches an `EventRecordExternalRef` with:

- provider: `Google Business Profile`;
- reference type: `LOCAL_POST`;
- external ID: provider Local Post resource name;
- canonical URL when supplied by the provider;
- provider read-back evidence.

This preserves EventRecord as the source of truth for event occurrence identity and schedule.

## Official provider assumptions validated 2026-08-15

The architecture is aligned to current official Google Business Profile documentation:

- OAuth uses `https://www.googleapis.com/auth/business.manage`;
- Business Information `locations.get` requires a read mask;
- `locations.getGoogleUpdated` is available for Google-side profile updates;
- Local Posts expose create and get/read-back operations, including event posts;
- verified-location reviews expose list/get and `updateReply`;
- review replies are bounded to 4096 bytes;
- Notifications use Cloud Pub/Sub and include review/profile-related events;
- Business Profile Performance exposes multi-daily metric time series;
- Google Business Profile APIs do not provide a sandbox, so lifecycle promotion must rely on
  controlled real-provider evidence and read-back rather than test-side public writes.

## Explicit exclusions

This implementation does not add or implement:

- R33;
- CRM core records;
- email;
- WhatsApp;
- Google Ads;
- ticketing;
- unrestricted review auto-reply;
- profile or hours writes;
- public MCP exposure or production promotion for Google Business writes.

## Exit criteria

The branch is complete only after:

1. all 14 capability IDs resolve under R07/R30/R31;
2. all five subflows are present under those existing routes;
3. EventRecord linkage is covered by tests;
4. complaints/legal/crisis require human-review evidence;
5. public writes remain R27 + provider-read-back governed and non-production;
6. the full repository `pnpm quality` passes;
7. PR Quality Gate is green at a fixed head SHA;
8. merge uses that exact green head;
9. post-merge `main` Quality Gate is green.
