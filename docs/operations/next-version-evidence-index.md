# TOCA OS Next Version — Evidence Index

Status: **ACTIVE / EXACT-HEAD SCOPED**  
Round: 2026-08-20 02:32 America/Bahia

## Evidence rules

Valid lifecycle:

`IMPLEMENTED -> CI_VERIFIED -> PROVIDER_VERIFIED -> PRODUCTION_VERIFIED`

1. Evidence belongs to the exact commit/head that produced it.
2. Any material commit, rebase, retarget, merge-from-main, conflict resolution, migration renumber or workflow cleanup requires fresh evidence for merge readiness.
3. Required Quality means Format + Architecture + Lint + Typecheck + Unit + Build.
4. Persistence/migration work additionally requires PostgreSQL E2E and applicable restart/retry/idempotency evidence.
5. CI cannot substitute for provider readback.
6. Provider evidence cannot substitute for production deployment/readback.
7. No provider side effect is executed solely to manufacture evidence.
8. A green run does not make a PR merge-ready if a temporary/diagnostic workflow, stale stack, migration collision or architecture ownership conflict remains.

## Frozen V1 evidence

| Claim                             | State                 | Evidence                                           |
| --------------------------------- | --------------------- | -------------------------------------------------- |
| V1 release identity               | `PRODUCTION_VERIFIED` | `abfb09b17e90c83790e803dcda091c8142c7407f`         |
| Canonical V1 state                | `PRODUCTION_VERIFIED` | `docs/operations/v1-canonical-state-2026-08-20.md` |
| Final V1 hosted closeout          | `PRODUCTION_VERIFIED` | `docs/operations/v1-final-closeout-2026-08-20.md`  |
| Final runtime redeploy            | `PRODUCTION_VERIFIED` | run `32325385858`                                  |
| Final hosted production readback  | `PRODUCTION_VERIFIED` | run `32325385886`                                  |
| Sanitized final readback artifact | `PRODUCTION_VERIFIED` | artifact `9393447493`                              |

V1 evidence is immutable and is not invalidated by Next Version work.

## Next Version exact-head matrix

| PR  | Feature                      | Exact head observed                        | Evidence state                   | Quality                                                            | PostgreSQL / specialized                                              | Provider evidence / caveat                                                                      |
| --- | ---------------------------- | ------------------------------------------ | -------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| #14 | Creative Truth               | `de3ec2f6f208efea9ce8fb1146c92abcfd9e8f7c` | `CI_VERIFIED`                    | `32335049796` PASS                                                 | `32335049795` PASS                                                    | no provider mutation required for CI claim                                                      |
| #15 | Demand Intelligence          | `ee7cb048b01e6859beb949b9d049f218b8e31f56` | `PROVIDER_VERIFIED` READ only    | `32333934188` PASS                                                 | `32333934183` PASS                                                    | provider READ `32333785052`; artifact `9393934030`; `writeExecuted=false`                       |
| #16 | Photo-to-Video               | `c0b23b573bec4de42746de2915e92daa36532a7b` | `CI_VERIFIED`                    | `32335823551` PASS                                                 | no new migration                                                      | stacked on #14; provider promotion blocked by rights/likeness/approval                          |
| #18 | Asset Intelligence           | `1bfa2680b1d661d865c7901303bf3c3d75dc6235` | `CI_VERIFIED`                    | `32334357073` PASS                                                 | `32334357088` PASS                                                    | migration collision prevents merge readiness                                                    |
| #19 | Privacy / LGPD               | `a63458971fc6971c97c7221da02c61b8bb085e21` | `CI_VERIFIED`                    | exact validator `32334687755` PASS; integration `32334417380` PASS | no new migration                                                      | no provider claim                                                                               |
| #20 | Platform Hardening           | `ccfde23ebe55b3fcf76b661fe1d9f9603e4cb494` | `IMPLEMENTED`                    | `32334666158` PASS                                                 | Security `32334666190` FAIL                                           | candidate-container scan and dependency review failed; CodeQL passed                            |
| #21 | AG-01                        | `20d55bf0de8368378380dcb3b3ba65b460b26b0e` | `CI_VERIFIED`, merge hold        | `32335887999` PASS                                                 | `32335888008` PASS                                                    | repair workflow remains in diff; no provider promotion                                          |
| #22 | CRM / Sales                  | `8fa24ba0e5dfb3708f77dab1596d609d37d10755` | `CI_VERIFIED`, merge hold        | `32336063124` PASS                                                 | `32336063161` PASS                                                    | one-shot workflow remains; canonical Conversation/Message owner                                 |
| #23 | Email / SendGrid             | `5aa954c82912cb48e022575e64b0ec7aa6d9443f` | `IMPLEMENTED`                    | no current normal full Quality claim                               | `32335836596` PG PASS; Email Gate `32335836602` overall FAIL          | Email-owned subgraph passes; stacked repo typecheck fails; sender/domain/provider config absent |
| #24 | Social Engagement            | `dedcf3d78786ab35c5b0fdb25e76f15bdbb8497b` | `CI_VERIFIED`                    | `32334785013` PASS                                                 | `32334784974` PASS                                                    | new full feature not provider-promoted; activation waits #19/#22                                |
| #25 | WhatsApp duplicate candidate | `d36fde463f89f9ad49fcf1858097501ed7815674` | `CI_VERIFIED`, architecture hold | `32335362897` PASS                                                 | `32335362899` PASS                                                    | duplicate Conversation/Message ownership; candidate superseded after preservation review        |
| #26 | R31 / Learning               | `0e58fd3f109c31986d0ef854f88bfa02ecf01c16` | `IMPLEMENTED`                    | `32336012297` FAIL Format                                          | `32336012300` PASS                                                    | no provider write required for learning engine                                                  |
| #27 | Analytics / Capacity         | `9639cc8056d62551ceb298488eabefd213cfa11d` | `IMPLEMENTED`                    | `32336060637` FAIL Format                                          | base PG `32336060639` PASS; dedicated analytics PG `32336060638` FAIL | read-only feature; dedicated functional E2E still failing                                       |
| #28 | Paid Media / Google Ads      | `579e6e402e860c20ce428277c836f5ae9488a857` | `IMPLEMENTED` snapshot           | `32336319196` in progress at readback                              | `32336319232` in progress at readback                                 | Google Ads provider verification pending; no activation for testing                             |
| #29 | Human Control Center         | `6976825a18b5cc1179ef8e73d72e135705508030` | `CI_VERIFIED`                    | `32335977430` PASS                                                 | no migration                                                          | no direct provider write; dependency panels fail closed                                         |
| #30 | Multi-tenant foundation      | `7677495c0d54c63354645c78ee86a0d502ced924` | `IMPLEMENTED`                    | `32336071267` FAIL Format                                          | `32336071284` PASS                                                    | no provider claim; migration collision 027                                                      |
| #31 | WhatsApp intended owner      | `5eee722e2589b746786906fd3bd9eebc1032295a` | `IMPLEMENTED`                    | `32336105089` FAIL Format                                          | `32336105114` PASS                                                    | temp workflow + stale CRM stack + migration collision + WABA/scopes/readback blocker            |

## Evidence-specific notes

### PR #15 provider READ

Permanent evidence document: `docs/operations/demand-intelligence-provider-read-evidence-2026-08-20.md`.

Sanitized observed provider values:

- `estimate_ready=true`
- modeled MAU lower `74300`
- modeled MAU upper `87500`
- midpoint `80900`
- `providerReadOnly=true`
- `writeExecuted=false`

This is an aggregate modeled Meta audience estimate, not an exact count of people, phones or devices physically present in Morro de São Paulo.

### PR #20 security gate

Security Supply Chain `32334666190` cannot be represented as green:

- dependency audit: PASS
- committed-history secret scan: PASS
- filesystem scan: PASS
- candidate container build: PASS
- candidate container scan: **FAIL**
- CodeQL: PASS
- dependency review: **FAIL**
- SBOM generation/upload: skipped after failure

Because PR #20's own promotion rule requires both normal Quality and Security Supply Chain, its current state remains `IMPLEMENTED`.

### PR #23 Email

Email Provider Gate `32335836602` has mixed evidence:

- Email-owned verification: PASS
- Email Prettier/Lint/typecheck: PASS
- Email unit tests: 22/22 PASS
- stacked repository integration: FAIL at repository typecheck
- repository build: skipped

The failure occurred on a stale snapshot of parent PR #22. Since #22 subsequently reached a different green head, #23 must restack on that clean final parent and rerun normal Quality + Email Provider Gate + PostgreSQL E2E. Provider promotion additionally requires real sender/domain, SPF, DKIM, DMARC, credentials, webhook keys and delivery/readback evidence.

### Final-tree hygiene evidence

The following current diffs contain workflows that mutate/repair the feature branch and therefore cannot be present in a final merge-ready head:

- #21 `.github/workflows/ag01-type-repair.yml`
- #22 `.github/workflows/crm-sales-catalog-one-shot.yml`
- #31 `.github/workflows/format-whatsapp-stack-once.yml`

Their removal is itself a material head change; fresh gates are mandatory after cleanup.

## Migration-evidence rule

Current collisions:

- `022`: #15 vs #18
- `024`: #23 vs duplicate/superseded-candidate #25
- `027`: #30 vs #31

A migration renumber changes the exact tested tree. Therefore the PR must be demoted from merge-readiness until its new exact head receives the applicable full Quality and PostgreSQL E2E evidence.

## Coordinator control-plane evidence

Branch: `coord/next-version-control-plane-20260820`.

Before this round, exact coordinator head `cb04de63e51da88ab68df2aa44cb814a797cb724` had Quality `32334144393` PASS. That evidence remains historical for that exact head only.

This round modifies the coordinator artifacts. The updated coordinator head must remain `IMPLEMENTED` until a new exact-head Quality Gate passes. No provider evidence is applicable to the coordinator docs/registry-only scope.

## Provider-evidence boundary

Provider evidence is mandatory before the corresponding promotion where work touches:

- WhatsApp sends/status callbacks/readback;
- Email sends/delivery/bounce/complaint/unsubscribe/readback;
- Meta Ads live demand reads or governed writes;
- Google Ads live account/provider execution;
- payment/ticketing/conversion evidence;
- OpenAI video generation;
- external AG-01 provider/model execution claims;
- production observability/DR claims involving managed cloud state.

Pure docs/contracts can reach `CI_VERIFIED` without external side effects, but never `PROVIDER_VERIFIED` or `PRODUCTION_VERIFIED` without matching external evidence.
