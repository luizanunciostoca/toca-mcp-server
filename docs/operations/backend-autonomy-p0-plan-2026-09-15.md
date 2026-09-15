# TOCA OS — Backend Autonomy P0 Completion Plan — 2026-09-15

Status: `ACTIVE_EXECUTION`

Baseline: `main@1d7c8cb9d31556a769bda835fd94e225fed510d5`

Tracking issue: `#811`

Execution branch: `wave/backend-autonomy-p0-20260915`

## Objective

Finish the backend/runtime required for governed autonomous operation before any new Control Center UX work. This work must not introduce a second MCP, policy engine, approval engine, scheduler, CRM, audit ledger, outbox, or provider execution path.

## P0 gates

1. Revalidate AG-01 against current main and current production contracts.
2. Certify current-head CI/security/autonomy gates.
3. Prove AG-01 production readiness: durable checkpoint/resume, PostgreSQL, canonical TOCA_OS routing parity, Core gateway, approvals, fail-closed provider uncertainty, authenticated health/readiness.
4. Reconcile current runtime/provider evidence against current main without inflating lifecycle status.
5. Keep all unsupported provider writes blocked; no capability is promoted without provider write/readback/idempotency/reconciliation evidence.
6. Define but do not self-promote bounded preapproved autonomy classes. Human evidence is required before authority expansion.
7. Produce final current-head production closeout evidence before starting Control Center v2.

## Required evidence

- exact current main SHA;
- required branch-protection checks green;
- AG-01 deployment revision and image/source identity;
- `/healthz` and authenticated `/readyz` evidence;
- PostgreSQL migration/read/write checkpoint evidence;
- route -> agent -> SOP/template -> Core capability lineage;
- approval wait/deny/revoke evidence;
- duplicate/idempotency evidence;
- restart/resume evidence;
- provider-timeout/unknown-outcome fail-closed evidence;
- audit/outbox/event correlation;
- provider evidence manifest reconciled to the current runtime;
- explicit blockers for every capability that remains non-executable.

## Safety invariant

A successful CI run, implementation, catalog entry, runtime flag, historic provider smoke, or UI surface is never sufficient by itself to grant external authority. External side effects remain denied unless the canonical Autonomy Gate has current identity, tenant, lifecycle, policy, approval/preapproval authority, idempotency, readiness, provider health, circuit and evidence.

## Definition of backend-complete

The backend can operate continuously without an open ChatGPT conversation: event/timer/request -> durable AG-01 -> canonical route/context -> governed Core capability -> approval only when policy requires it -> provider -> readback -> reconciliation -> audit/outbox/event -> learning. Any missing/ambiguous external evidence fails closed and raises a governed human escalation instead of guessing or blindly retrying.
