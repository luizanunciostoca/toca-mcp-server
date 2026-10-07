# TOCA OS Content Lifecycle v2

## Purpose

Define one canonical lifecycle for every marketing content item across Google Drive / TOCA OS, the Marketing Autopilot registry, PostgreSQL and the TOCA-managed Instagram scheduler.

## Canonical state machine

```text
PLANNED
  -> SOURCE_BOUND
  -> BRIEFED
  -> PRODUCED
  -> QA_PASS
  -> APPROVED
  -> SCHEDULER_READY
  -> TOCA_SCHEDULED
  -> PUBLISHED
  -> RECONCILED
```

`CANCELED` is an exceptional terminal off-ramp and is not part of the normal production path.

`MISSED_WINDOW` and `SUPERSEDED` are operational dispositions. They must never replace the lifecycle state.

## State contracts

### PLANNED

The editorial slot, product, channel, format, objective and timing exist. No source asset is yet canonically bound.

### SOURCE_BOUND

The content item has an exact canonical source binding (`source_asset_id` / stable file identity) and lineage can be established. Asset discovery must not be repeated unless the binding is explicitly invalidated.

### BRIEFED

Message, CTA, visual intent, product truth and production instructions are resolved against the bound source.

### PRODUCED

A final candidate artifact exists. For static content this means the actual final image file; for video, the final candidate export. `PRODUCED` alone never authorizes scheduling or publication.

### QA_PASS

The exact produced artifact passed the applicable Information, Visual, Copy, Strategy, Brand Integrity, Venue Fidelity and Quality gates. A QA failure leaves the item at `PRODUCED`; it does not invent a new lifecycle state.

### APPROVED

Human or explicitly authorized approval exists for the exact artifact/copy/version combination. Any material change invalidates the approval and requires a new governed version.

### SCHEDULER_READY

All publication prerequisites are complete: immutable final asset, exact asset binding, copy, schedule time/timezone, account, descriptor data, idempotency key and required gate evidence. This is the only normal predecessor of `TOCA_SCHEDULED`.

### TOCA_SCHEDULED

A durable TOCA-managed scheduler job exists in PostgreSQL with immutable approved descriptor evidence. This does not mean Instagram provider-native scheduling.

### PUBLISHED

Provider-backed publication confirmation exists.

### RECONCILED

TOCA OS has reconciled the scheduler job, execution record and provider media evidence and has written the final canonical state/evidence back to the business registry. This is the normal terminal state.

## Operational dispositions

`operational_disposition` is orthogonal to lifecycle state:

- `ACTIVE`
- `MISSED_WINDOW`
- `SUPERSEDED`
- `CANCELED`

A missed publishing window must not turn a `PRODUCED` item into a fake lifecycle status. It remains `PRODUCED` with `operational_disposition=MISSED_WINDOW`.

## Source-of-truth rule

The canonical operational record for marketing execution is the current TOCA OS Marketing Autopilot Content Registry. Asset-binding sheets are supporting registries and must synchronize into the canonical content record rather than compete with it.

The synchronization rule is:

```text
ASSET_BINDINGS
  -> CONTENT_ITEMS.source_asset_id/source_drive_file_id
  -> SOURCE_BOUND
```

Existing source binding must be reused. Re-discovery is allowed only when the binding fails truth/rights/quality checks or is explicitly superseded.

## Quality and approval rule

No transition may skip a gate. In particular:

- `PRODUCED -> APPROVED` is forbidden;
- `QA_PASS -> SCHEDULER_READY` is forbidden;
- `APPROVED -> TOCA_SCHEDULED` is forbidden;
- `TOCA_SCHEDULED -> RECONCILED` without provider-backed `PUBLISHED` evidence is forbidden.

## Scheduler boundary

TOCA-managed organic scheduling uses:

```text
APPROVED
  -> SCHEDULER_READY
  -> instagram.toca_schedule.prepare
  -> descriptor approval
  -> instagram.toca_schedule.create
  -> TOCA_SCHEDULED
```

The transport-level provider-native `SCHEDULED` label, where supported by a provider, is not a content lifecycle state.

## Backlog execution policy

For the September 2026 production window the operational priority is:

1. close 03/09;
2. close the complete 04/09 Sunset -> The Party narrative;
3. QA the already produced Sunset feeds for 05-09/09 as a batch;
4. produce the bound Sunset Stories for 05-09/09 as a batch;
5. reconcile Asset Bindings into Content Registry;
6. advance only approved exact artifacts to `SCHEDULER_READY` and schedule them through the governed TOCA scheduler.

## Fail-closed rules

- no source binding: cannot become `SOURCE_BOUND`;
- no final artifact: cannot become `PRODUCED`;
- failed QA: cannot become `QA_PASS`;
- no explicit approval: cannot become `APPROVED`;
- incomplete descriptor/gates: cannot become `SCHEDULER_READY`;
- no durable job evidence: cannot become `TOCA_SCHEDULED`;
- no provider confirmation: cannot become `PUBLISHED`;
- no final registry/provider reconciliation: cannot become `RECONCILED`.
