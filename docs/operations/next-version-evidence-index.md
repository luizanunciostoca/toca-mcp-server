# TOCA OS Next Version — Evidence Index

Status: **ACTIVE / EXACT-HEAD SCOPED**  
Round: 2026-08-20 02:50 America/Bahia

## Evidence rules

Lifecycle:

`IMPLEMENTED -> CI_VERIFIED -> PROVIDER_VERIFIED -> PRODUCTION_VERIFIED`

- Evidence belongs only to the exact SHA that produced it.
- Rebase, retarget, merge-from-main, conflict resolution, migration renumber, workflow cleanup or other material commit requires fresh applicable evidence.
- `CI_VERIFIED` requires full Quality: Format + Architecture + Lint + Typecheck + Unit + Build.
- Persistence/migration work additionally requires PostgreSQL E2E and applicable restart/retry/idempotency evidence.
- Provider-shaped fixtures are not provider evidence.
- Green CI does not override migration collisions, duplicate domain ownership, stale stacks, forbidden workflows or missing provider readback.
- No provider/business side effect is executed solely to manufacture evidence.

## Frozen V1

| Claim                             | State                 | Evidence                                           |
| --------------------------------- | --------------------- | -------------------------------------------------- |
| V1 release identity               | `PRODUCTION_VERIFIED` | `abfb09b17e90c83790e803dcda091c8142c7407f`         |
| Canonical V1 state                | `PRODUCTION_VERIFIED` | `docs/operations/v1-canonical-state-2026-08-20.md` |
| Final V1 closeout                 | `PRODUCTION_VERIFIED` | `docs/operations/v1-final-closeout-2026-08-20.md`  |
| Final runtime redeploy            | `PRODUCTION_VERIFIED` | run `32325385858`                                  |
| Final hosted production readback  | `PRODUCTION_VERIFIED` | run `32325385886`                                  |
| Sanitized final readback artifact | `PRODUCTION_VERIFIED` | artifact `9393447493`                              |

V1 evidence is immutable and is not invalidated by Next Version work.

## Next Version matrix

| PR  | Feature                 | Exact current/verified head                        | State                         | Quality                                                            | PostgreSQL / specialized                                    | Provider / caveat                                                                                                                                 |
| --- | ----------------------- | -------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| #14 | Creative Truth          | `de3ec2f6f208efea9ce8fb1146c92abcfd9e8f7c`         | `CI_VERIFIED`                 | `32335049796` PASS                                                 | `32335049795` PASS                                          | no provider mutation claimed                                                                                                                      |
| #15 | Demand Intelligence     | `ee7cb048b01e6859beb949b9d049f218b8e31f56`         | `PROVIDER_VERIFIED` READ only | `32333934188` PASS                                                 | `32333934183` PASS                                          | READ `32333785052`, artifact `9393934030`, `writeExecuted=false`                                                                                  |
| #16 | Photo-to-Video          | `c0b23b573bec4de42746de2915e92daa36532a7b`         | `CI_VERIFIED`                 | `32335823551` PASS                                                 | no migration                                                | parent #14 must merge/retarget/revalidate; provider rights/likeness/approval pending                                                              |
| #18 | Asset Intelligence      | `1bfa2680b1d661d865c7901303bf3c3d75dc6235`         | `CI_VERIFIED`                 | `32334357073` PASS                                                 | `32334357088` PASS                                          | migration collision prevents merge readiness                                                                                                      |
| #19 | Privacy / LGPD          | `a63458971fc6971c97c7221da02c61b8bb085e21`         | `CI_VERIFIED`                 | exact validator `32334687755` PASS; integration `32334417380` PASS | no new migration                                            | no provider promotion                                                                                                                             |
| #20 | Platform Hardening      | `ccfde23ebe55b3fcf76b661fe1d9f9603e4cb494`         | `IMPLEMENTED`                 | `32334666158` PASS                                                 | Security `32334666190` FAIL                                 | container scan + dependency review failed; CodeQL passed                                                                                          |
| #21 | AG-01                   | `9f5dd275b3823c3d435b42ccd2d51a1662bae383`         | `CI_VERIFIED`                 | `32336668556` PASS                                                 | `32336668600` PASS                                          | final diff clean; provider evidence not claimed                                                                                                   |
| #22 | CRM / Sales             | `be97c0a6249876ff306a67158ae35e94c217bd6d`         | `CI_VERIFIED`                 | `32336854798` PASS                                                 | `32336854963` PASS                                          | final diff clean; canonical Conversation/Message owner                                                                                            |
| #23 | Email / SendGrid        | current `036bbec4aff0f77eede4ae36fb347b12967b0ada` | `IMPLEMENTED` current head    | current runs were in progress at readback                          | current runs in progress                                    | prior `fe078cc70f720e15f34fba445a21624fcd45df37` had Email `32336964937`, Quality `32336964982`, PG `32336964932` PASS; cannot carry to newer SHA |
| #24 | Social Engagement       | `dedcf3d78786ab35c5b0fdb25e76f15bdbb8497b`         | `CI_VERIFIED`                 | `32334785013` PASS                                                 | `32334784974` PASS                                          | full feature not provider-promoted; activation waits #19/#22                                                                                      |
| #26 | R31 / Learning          | `7675bd734d0c11bdff8357656b9b0a1a6253a8b7`         | `CI_VERIFIED`                 | `32336459217` PASS                                                 | `32336459216` PASS                                          | recommendation/evidence engine; no live provider write                                                                                            |
| #27 | Analytics / Capacity    | `ce65dbfb686b4e64a35a209de3517ddb2762bec9`         | `IMPLEMENTED`                 | `32336961228` FAIL Format                                          | base PG `32336961148` PASS; analytics PG `32336961160` PASS | read-only; not CI_VERIFIED until full Quality green                                                                                               |
| #28 | Paid Media / Google Ads | `85ae60e95300a1d3fb73d35cd7b0083a4a980c72`         | `IMPLEMENTED`                 | `32336953445` FAIL Format                                          | `32336953388` PASS                                          | Google Ads real account/OAuth READ evidence pending; no activation for testing                                                                    |
| #29 | Human Control Center    | `6976825a18b5cc1179ef8e73d72e135705508030`         | `CI_VERIFIED`                 | `32335977430` PASS                                                 | no migration                                                | same MCP; no direct provider write                                                                                                                |
| #30 | Multi-tenant            | `2fce39b05f99185a3db0763be82097b272561b35`         | `CI_VERIFIED`                 | `32336878038` PASS                                                 | base PG `32336878082` PASS; tenancy PG `32336878062` PASS   | migration `027` collision still blocks merge readiness                                                                                            |
| #31 | WhatsApp candidate A    | `256f66051198f41577bff69bbbab261126e2581f`         | `IMPLEMENTED`                 | `32336999395` FAIL Lint                                            | `32336999185` PASS                                          | duplicate with #36; WABA/scopes/readback absent                                                                                                   |
| #33 | Attribution / Revenue   | `7e8df19ae23da2193ddb6e4e64d127b86b49729a`         | `CI_VERIFIED`                 | `32336942395` PASS                                                 | `32336942409` PASS                                          | provider-shaped payment fixtures do not count as provider evidence                                                                                |
| #36 | WhatsApp candidate B    | `7e1e581894510fc56e54075ccd121a980cea4f4c`         | `IMPLEMENTED`                 | `32337031616` FAIL Lint                                            | `32337031654` PASS                                          | duplicate with #31; WABA/scopes/readback absent                                                                                                   |

## Closed non-merge PRs

- #25 — closed unmerged / superseded; obsolete duplicate CRM communication model.
- #32 — closed unmerged; temporary Email stack synchronization.
- #34 — closed unmerged; temporary Email rebase synchronization.
- #35 — closed unmerged; test-only Email hardening runner, explicitly never a merge source.

Their historical green or red runs do not promote any active feature head.

## Provider evidence notes

### Demand Intelligence / #15

Permanent evidence document: `docs/operations/demand-intelligence-provider-read-evidence-2026-08-20.md`.

Observed sanitized provider values:

- `estimate_ready=true`
- modeled MAU lower `74300`
- modeled MAU upper `87500`
- midpoint `80900`
- `providerReadOnly=true`
- `writeExecuted=false`

This is an aggregate modeled Meta audience estimate, not an exact count of people, phones or devices physically present in Morro de São Paulo.

### Security / #20

Security Supply Chain `32334666190`:

- dependency audit: PASS
- committed-history secret scan: PASS
- filesystem scan: PASS
- candidate container build: PASS
- candidate container scan: **FAIL**
- CodeQL: PASS
- dependency review: **FAIL**
- SBOM generation/upload: skipped after failure

The PR therefore remains `IMPLEMENTED` for its declared hardening scope until the security gate is fully green on the exact head.

### Email / #23

A prior clean Email head `fe078cc70f720e15f34fba445a21624fcd45df37` produced:

- Email Provider Gate `32336964937`: PASS
- Quality `32336964982`: PASS
- PostgreSQL E2E `32336964932`: PASS

The active branch then advanced to `036bbec4aff0f77eede4ae36fb347b12967b0ada`. Because evidence is exact-head scoped, the active head remains `IMPLEMENTED` until its new Quality + Email Provider Gate + PostgreSQL E2E finish green.

Even after CI, provider promotion requires real sender/domain, SPF, DKIM, DMARC, credentials, webhook keys, controlled delivery/readback, bounce/complaint/unsubscribe reconciliation, and other documented provider evidence. No send is authorized solely to make the evidence state green.

### WhatsApp / #31 and #36

Both active candidates are stacked on canonical CRM #22 and both current PostgreSQL E2E runs pass, but both Quality runs fail at Lint after Format + Architecture succeed. More importantly, two implementations cannot coexist.

Semantic comparison found non-identical useful behavior:

- #31: explicit runtime audit writes, canonical recipient/Contact channel match, ambiguity-aware CRM sales resolution, sales activity on human handoff;
- #36: media metadata readback and unmatched-status workflow handoff.

The final merge source must deliberately converge the strongest safe behavior from both and retain #22 as the sole commercial Conversation/Message owner. After convergence and migration serialization, fresh exact-head Quality + PostgreSQL E2E are required. `PROVIDER_VERIFIED` remains blocked until real WhatsApp scopes/WABA/Phone Number ID/template/callback/readback evidence exists.

### Attribution / Revenue / #33

`CI_VERIFIED` proves the contracts, persistence and fail-closed revenue/WON logic at head `7e8df19...`; it does **not** prove real ticketing/checkout/payment/order provider readback. Provider-shaped PAYMENT fixtures are test evidence only. Real commerce provider evidence is required before provider/production promotion of revenue claims.

## Migration evidence rule

Current open-branch collisions:

- `022`: #15 vs #18
- `027`: #30 vs WhatsApp #31/#36

The old `024` collision from #25 is no longer active because #25 is closed unmerged.

A migration renumber changes the tested tree. After any renumber, the prior exact-head Quality/PG evidence becomes historical and the resulting SHA must rerun all applicable gates.

## Coordinator evidence

Coordinator branch: `coord/next-version-control-plane-20260820`.

Historical exact coordinator head `a5412eb4fa03044348700295457ee319c0305fe7` passed Quality `32336832810` after its one-shot formatting helper was removed. This round has since modified the coordinator artifacts again to incorporate #33/#36 and later workstream cleanup. Therefore that earlier evidence is historical only; the final coordinator head must receive a new exact-head Quality before this round can be called `CI_VERIFIED`.

No provider evidence is applicable to the coordinator documentation/registry-only scope.
