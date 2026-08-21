# TOCA OS Next — Evidence-Gated Final Roadmap

This roadmap is ordered by dependency and evidence, not by PR creation time.

## Phase 0 — Continuous coordination

Before every merge or mutating environment action:

1. re-read live `main` SHA;
2. inventory open/merged PRs;
3. compare shared hotspots semantically;
4. re-read migration filenames on live `main`;
5. verify exact-head CI for the candidate PR;
6. keep CI evidence separate from provider/staging/production evidence;
7. reject any lifecycle promotion unsupported by a real evidence reference.

## Phase 1 — Finish code convergence

### Front A — Provider Onboarding + Google Ads

Required before code freeze:

- make credential-first customer discovery reachable through the existing Google Ads client/runtime composition without inventing a provider abstraction;
- preserve fail-closed customer-bound reads/writes until customer/guardrail configuration is known;
- define a governed provider-verification bootstrap that can collect read evidence and later a controlled create-paused/readback without declaring the capability production-validated in advance;
- reconcile the exact runtime capability surface to the TOCA_OS catalog rather than creating historical checklist aliases merely for completeness;
- run exact-head source gates on the final implementation.

External credentials may remain a provider-verification blocker after code convergence; that does not justify false provider state.

### Front B — Omnichannel Outbound + Nurture

Required before code freeze:

- compose existing Email/WhatsApp outbound engines through canonical AG-01/Workflow/Core execution;
- expose only canonical capability IDs and contracts;
- use canonical CRM Conversation/Message, Privacy, Policy, Approval, Audit and Outbox;
- implement durable nurture/follow-up by consuming existing NextAction/Workflow/Scheduler state, including restart safety and execution-time Privacy revalidation;
- prove no second CRM, scheduler, workflow engine or provider runtime exists;
- run exact-head Quality/Security/PostgreSQL/Email gates as applicable.

### Front C — Platform Readiness

Do not create another platform-hardening implementation while #55 remains semantically current. If A/B move `main` in shared hotspots or deployment contracts, rebuild only the necessary readiness delta on the final code-complete main and rerun exact-head source gates.

### Front D — Governance / Drive

Keep TOCA_OS route/capability/provider lifecycle truth synchronized without promoting evidence states. Governance changes must describe runtime truth, not make runtime truth true by declaration.

## Phase 2 — Freeze one candidate

Only after A/B are code-complete and all integration PRs are merged correctly:

- re-read live `main`;
- ensure no competing implementation PR exists;
- verify migration ordering and no filename collision;
- revalidate `src/server.ts`, `src/http.ts`, `src/registry.ts`, `src/config.ts`, `src/mcp/` and governance contracts;
- require exact-head source CI;
- record the exact immutable candidate SHA.

No further feature merge is allowed into that candidate without invalidating the freeze and restarting this phase.

## Phase 3 — Staging, fail closed

Before any migration/deploy mutation prove, with environment readback:

- staging project ID/number != production;
- staging Cloud SQL != production;
- staging database secret != production;
- staging MCP/webhook service names != production;
- staging runtime/deploy identities != production;
- staging WIF != production;
- provider mode is DISABLED or explicitly ISOLATED;
- required secrets resolve only inside the staging project.

If any proof is missing, abort mutation.

Then execute:

- migrations + second migration drift check;
- schema/readiness/liveness;
- Audit/Outbox/Approval/CRM/AG-01/tenant isolation;
- canonical inbound paths;
- approval wait/approve/resume;
- nurture restart/privacy revalidation;
- provider-disabled behavior where evidence is absent;
- controlled provider E2E only for providers whose credentials and verification boundary are ready.

Record exact revision, image digest, migration set, request IDs, readbacks and evidence refs.

## Phase 4 — Provider verification

Provider verification is independent of source CI.

For each provider, record:

- credential/binding identity without secret values;
- provider account/resource selected;
- read request/provider refs;
- required permissions/scopes/billing/domain/template state;
- exact controlled side effect if one is required;
- formal approval identity/ApprovalRecord where required;
- idempotency key;
- provider resource/message/campaign ref;
- authoritative readback;
- Audit and Outbox evidence;
- rollback/cleanup evidence.

A fixture, mocked response, config flag, catalog status, or CI test cannot satisfy provider verification.

## Phase 5 — Production promotion

Production mutation requires:

- exact staging evidence reference for the same candidate/image;
- explicit production authorization reference;
- immutable image digest;
- migration plan/readback;
- rollback target;
- verified provider bindings only for providers being enabled;
- canary/readiness/SLO gates before full traffic.

Do not enable a provider merely because its implementation is CI verified.

## Phase 6 — Reliability verification

After production deployment, verify:

- SLO/SLI collection for AG-01/Core/Approval/providers/CRM/Outbox/workflow;
- real or non-destructive synthetic alert firing and notification delivery;
- alert policy/channel readback and runbook correlation;
- backup/PITR state;
- isolated restore/recovery drill rather than destructive production restore;
- RPO/RTO evidence;
- recovery of Next tables, AG-01/workflow state and secrets/config;
- provider revalidation after recovery where applicable;
- rollback evidence.

## Phase 7 — Final closeout

Only now update the canonical closeout artifacts. Every positive claim must be backed by an evidence ref answering:

- production source SHA;
- image/digest;
- revision/service;
- migrations;
- provider/account read;
- side effect executed;
- approver and ApprovalRecord;
- request/provider ref;
- readback;
- Audit;
- Outbox;
- rollback;
- exact evidence reference.

Unknown, blocked or not-executed states remain explicit; they are never inferred from implementation or CI.
