# Instagram Engagement Validation Lineage V3

Status: ACTIVE PROCESS CORRECTION

## Purpose

Do not conflate provider transport validation with live autonomy eligibility.

A missing eligible customer conversation is not evidence that the Meta transport, webhook ingestion, provider binding or reply adapter is broken. The controlled-write process must preserve prior provider-backed evidence and only repeat a real external write when the capability under test has materially changed or a fresh operational canary is specifically required.

## Proven lineage

### Direct transport

Canonical repository evidence records a controlled real Instagram Direct reply with:

- exact Facebook Page / Instagram Business Account binding;
- Page `MESSAGING` task validation;
- Page Access Token routing;
- `POST /{PAGE_ID}/messages` with `messaging_type: RESPONSE`;
- exactly one persisted DIRECT target;
- idempotency reservation before the side effect;
- no POST retry;
- provider `recipient_id` matched to the webhook sender-scoped recipient;
- provider acknowledgement persisted only after success.

The current `InstagramGraphEngagementProvider.sendDirectReply` retains those transport invariants and its regression tests enforce Page-token routing, linked-account validation and recipient acknowledgement matching.

### Comment / Direct ingress and conversation pipeline

Real provider webhooks have already been exercised for COMMENT and DIRECT ingestion. Later production-shadow runs additionally prove COMMENT + DIRECT authenticated ingestion, dedupe/outbox processing, FAQ resolution, thread/group behavior, low-confidence fail-closed behavior, P0 human escalation and zero external replies while writes are disabled.

This evidence proves the inbound and decision pipeline. It must not be discarded because a later real-write canary had no eligible recent customer target.

### Comment outbound

The current provider contains the comment reply adapter (`POST /{comment_id}/replies`) and COMMENT has end-to-end shadow evidence. Until a canonical record with a real comment-reply provider acknowledgement is located or produced, COMMENT outbound must not be described as freshly provider-ACK-validated by this V3 closeout.

## Correct gate model

The production sequence is now split into independent gates:

1. **TRANSPORT_LINEAGE** — historical provider-backed evidence plus current code regression invariants.
2. **CURRENT_PROVIDER_READINESS** — exact account/scopes/Page/Instagram binding readback; no send.
3. **AUTONOMY_ELIGIBILITY_READONLY** — database-only scan using the same confidence, priority, sensitive-data, commercial, urgency, intent and verified-fact requirements as the controlled-write canary.
4. **CONTROLLED_REAL_WRITE** — single-use explicit authorization only when the read-only eligibility gate is `READY`.
5. **ACK_RECEIPT** — exact provider acknowledgement, outbox receipt and no ambiguous/failed outcome.
6. **PERSISTENT_PROMOTION** — separate decision; never implied by a canary.

## Eligibility outcomes

`AUTONOMY_ELIGIBILITY_READONLY` returns one of:

- `READY` — exactly one eligible recent DIRECT exists; a later exact-SHA real-write authorization may be considered.
- `NO_ELIGIBLE_TARGET` — no eligible recent DIRECT exists. This is an operational no-op, not a transport or production defect.
- `MULTIPLE_ELIGIBLE_TARGETS` — more than one eligible recent DIRECT exists. Do not use this result as deterministic target authorization; require a later target-binding step or wait until a unique target is available.

Only hashes, aggregate counts and rejection categories may be emitted. Raw message text, sender IDs, provider tokens and private payloads are prohibited from diagnostic evidence.

## Merge/release rule

Non-write hardening may merge when its own Quality, Autonomy Safety, Security and required PostgreSQL E2E gates are green. It must not remain blocked solely to preserve an obsolete canary image or solely because there is no naturally eligible customer conversation.

After any merge that changes `main`, any future real-write canary still requires a fresh immutable runtime image built from the exact current SHA and a new single-use authorization. Historical transport evidence remains part of lineage, but it never authorizes a new external write by itself.

## No relaxation rule

This correction changes orchestration and interpretation only. It does not relax:

- HIGH confidence;
- P2/P3 for autonomous canary targets;
- low risk and low urgency;
- sensitive-data exclusion;
- commercial-intent exclusion for the autonomous canary;
- verified canonical facts / FAQ evidence;
- one-reply budget;
- maxAttempts=1;
- no blind retry after ambiguous provider outcome;
- persistent writes disabled by default.
