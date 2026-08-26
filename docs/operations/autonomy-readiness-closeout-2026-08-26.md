# Fechamento de Autonomia e Readiness do TOCA OS

| Metadado      | Valor                                                                |
| ------------- | -------------------------------------------------------------------- |
| Autor         | Manus AI                                                             |
| Data          | 26 de agosto de 2026                                                 |
| Branch GitHub | `feat/autonomy-readiness-hardening`                                  |
| Pull request  | [#281](https://github.com/luizanunciostoca/toca-mcp-server/pull/281) |
| Baseline      | `904210f2ed000ac1f99783d5f210e58da938e775`                           |
| Classificação | Engenharia, segurança operacional e governança                       |

## 1. Resultado executivo

A branch implementa a fundação técnica requerida para elevar o Marketing Autopilot com segurança, sem promover autonomia externa por inferência. A política do TOCA OS foi compilada em um artifact machine-readable, o Core passou a decidir side effects por um Autonomy Gate único, o readiness específico tornou-se fail-closed e o scheduler recebeu watchdog e reconciliação independente. A aprovação em lote preserva um `ApprovalRecord` por item; shadow, canary e R31 não podem conceder autoridade sem decisão humana.[1] [2] [3]

O gate oficial completo foi executado localmente com Node 24 e concluiu formatação, arquitetura, lint, typecheck, **204 arquivos de teste aprovados, 999 testes aprovados e build TypeScript**. Dezessete arquivos e 25 testes provider-backed/PostgreSQL permaneceram ignorados porque exigem infraestrutura externa não disponível nesta execução. Esses skips não são tratados como evidência de produção.[4]

> **Conclusão segura:** a branch foi publicada no GitHub, o [PR #281](https://github.com/luizanunciostoca/toca-mcp-server/pull/281) recebeu checks remotos verdes e a proteção da `main` foi aplicada com readback `PASS`. O merge permanece bloqueado pela aprovação humana exigida; também não existe sessão GCP autenticada para acceptance e deploy. O manifesto provider-backed contém zero validações, as capabilities `instagram.publish.*` permanecem `PLANNED` e o runtime continua fail-closed.

## 2. Requisitos e implementação

| Requisito                         | Implementação principal                                                                        | Evidência automatizada                                                      | Estado                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| Política efetiva única            | `control/effective-autonomy-policy.v1.json` e compiler `src/governance/autonomy-policy.ts`     | `check-effective-autonomy-policy.mjs` e `effective-autonomy-policy.test.ts` | Concluído localmente                       |
| Scheduling canônico               | `TOCA_MANAGED_SCHEDULING`, `TOCA_SCHEDULED` e `TOCA_SCHEDULE`                                  | `marketing-autopilot-scheduling.test.ts`                                    | Concluído localmente                       |
| Autonomy Gate único               | `src/core/autonomy-gate.ts`, integrado ao executor e à superfície MCP                          | `autonomy-gate.test.ts` e testes do Core                                    | Concluído localmente                       |
| Readiness Gate fail-closed        | `src/health/autopilot-readiness.ts` e `src/core/autonomy-runtime-context.ts`                   | `autopilot-readiness.test.ts`                                               | Concluído localmente                       |
| Modos graduais                    | `OFF`, `OBSERVE`, `ASSISTED`, `SUPERVISED_AUTO` e `PREAPPROVED_AUTO`                           | `autonomy-rollout.test.ts`                                                  | Concluído localmente                       |
| Kill switches granulares          | Global, tenant, provider e capability no contexto do Autonomy Gate                             | `autonomy-gate.test.ts`                                                     | Concluído localmente                       |
| Circuit breaker e provider health | Health/circuit por tenant e provider antes do side effect                                      | `autonomy-gate.test.ts`                                                     | Concluído localmente                       |
| Scheduler resiliente              | Watchdog, `updatedAt`, last poll/claim, backlog, lag, DLQ e latência                           | `scheduler-watchdog.test.ts` e testes do worker                             | Concluído localmente                       |
| Reconciliação periódica           | `src/scheduler/scheduler-reconciler.ts`, provider readback e reparo injetável seguro           | `scheduler-reconciler.test.ts`                                              | Concluído localmente                       |
| Aprovação em lote                 | UX agregada com hash, escopo, reserva e consumo independentes                                  | `approval-batch.test.ts` e atomicidade existente                            | Concluído localmente                       |
| Shadow e canary                   | Agreement exato, amostras mínimas, promoção humana e rollback                                  | `autonomy-rollout.test.ts`                                                  | Concluído localmente                       |
| Governança R31                    | Recomendações auditáveis; autoelevação proibida                                                | `learning-governance.test.ts`                                               | Concluído localmente                       |
| Métricas do Autopilot             | Shadow agreement, approval latency, scheduler lag, provider errors, intervenção e adoção       | `platform-slo-catalog.test.ts`                                              | Concluído localmente                       |
| Fault injection                   | Crash windows, 429/500, token, rede, duplicate webhook, clock, stale approval, drift e parcial | `autopilot-fault-injection.test.ts`                                         | Concluído localmente                       |
| Lifecycle provider-backed         | Evidence package individual por capability e exact-head                                        | `capability-validation-evidence.test.ts`                                    | Gate concluído; validações reais pendentes |
| Autonomy Safety CI                | Workflow dedicado com exact candidate e testes críticos                                        | `.github/workflows/autonomy-safety.yml`                                     | Executado no PR; PASS                      |
| Branch protection                 | Desired state com cinco checks, review, CODEOWNERS e bloqueios destrutivos                     | `check-main-branch-protection-policy.mjs`                                   | Aplicado; readback `PASS`                  |
| Deploy controlado                 | Gates existentes preservados; nenhuma promoção sem evidence package                            | Gate completo e contratos GCP existentes                                    | Não executado nesta sessão                 |

## 3. Decisão de autonomia efetiva

O artifact efetivo define **TOCA-managed scheduling** como autoridade canônica. Agendar no TOCA não equivale a usar o agendamento nativo do provider; `SCHEDULED` continua reservado para uma evidência nativa e `TOCA_SCHEDULED` representa a fila gerenciada pelo TOCA. `SHARE_NOW` só pode ser utilizado quando o comando explicita publicação imediata.[1]

O Autonomy Gate avalia identidade, tenant, capability lifecycle, policy, ApprovalRecord, descriptor SHA, idempotência, provider health, circuit breaker, readiness, modo e kill switches. A decisão retorna `ALLOW`, `REQUIRE_APPROVAL` ou `DENY`, acompanhada de reason code e evidências. Para side effects externos, ausência de readiness, health, policy version ou aprovação válida equivale a bloqueio.[2]

| Modo               | Trabalho interno              | Side effect externo                              | Condição de promoção                          |
| ------------------ | ----------------------------- | ------------------------------------------------ | --------------------------------------------- |
| `OFF`              | Bloqueado pelo modo           | Bloqueado                                        | Decisão humana                                |
| `OBSERVE`          | Decisão e evidência somente   | Bloqueado                                        | Shadow mínimo e sem divergência               |
| `ASSISTED`         | Preparação permitida          | Aprovação item a item                            | Readiness verde e operação supervisionada     |
| `SUPERVISED_AUTO`  | Automatizado dentro da policy | Aprovação explícita, exceto classe válida        | Canary, readback e SLOs verdes                |
| `PREAPPROVED_AUTO` | Automatizado                  | Somente classe pré-aprovada, com escopo e volume | Decisão humana; nunca promoção R31 automática |

## 4. Evidência provider-backed e promotion gate

`instagramPublicationWritesEnabled=true` não altera mais o lifecycle. O registry promove apenas a capability cujo evidence package comprove write real, provider readback, idempotência, reconciliação, fail-closed em outcome incerto, ambiente de produção e exact-head.[5]

O manifesto `control/capability-validation-evidence.v1.json` está canonicamente vazio. Isso é deliberado: os testes simulados provam o contrato do gate, não a capacidade real do provider. Cada futura promoção deve adicionar somente a capability efetivamente validada e deve ser acompanhada pelo recurso externo, acceptance run e readback correspondentes.

## 5. Watchdog, reconciliação e falhas

O watchdog produz snapshot estruturado de `lastPollAt`, `lastClaimAt`, `lastSuccessfulExecutionAt`, `lastReconciliationAt`, oldest due job, due/running/failed backlog, RUNNING stale, DLQ, execution latency e publication lag. O worker real emite essas métricas ao final de cada batch.[6]

O reconciliador consulta o provider por job, detecta idempotency keys duplicadas, RUNNING stale, provider indisponível, sucesso local sem comprovação e publicação confirmada que ainda não foi refletida localmente. O único reparo automático planejável é promover o estado local após readback de publicação com `externalResourceId` e evidência; outcome desconhecido nunca gera retry cego.[7]

A matriz de contenção diferencia falhas ocorridas antes da chamada externa das que ocorrem depois do início da chamada. Retry com backoff só é permitido quando o side effect comprovadamente não começou e existe idempotency key. Crash, 500 ou perda de rede após o início da chamada exigem reconciliação; token expirado abre o circuito; sucesso parcial vai para `FAILED_REVIEW_REQUIRED`.[8]

## 6. CI e proteção da main

O workflow **Autonomy Safety** valida o exact candidate, instala dependências bloqueadas, verifica policy/evidence packages, executa typecheck e roda testes de gates, scheduler, aprovação, rollout, R31, fault injection e capability validation. Todas as actions estão fixadas por SHA.[9]

O desired state de branch protection exige os checks `Quality Gate / quality`, três checks do Security Supply Chain e `Autonomy Safety / autonomy-safety`; também exige branch atualizada, review, CODEOWNERS, aprovação do último push, resolução de conversas e histórico linear, bloqueando force-push e deleção.[10]

O GitHub aplica `block_creations` somente em conjunto com restrições de push. Como essas restrições não estão disponíveis para repositório pessoal, o desired state registra `block_creations=false`; isso não altera a proteção da `main` existente nem os controles obrigatórios de merge.[11]

A aplicação remota é uma mutação administrativa e deve ser feita com token de administrador e readback no mesmo comando:

```bash
GITHUB_TOKEN=*** node scripts/apply-main-branch-protection.mjs --apply
```

Sem autenticação, o script opera em dry-run. Nesta execução, o comando autenticado concluiu com `BRANCH_PROTECTION_READBACK=PASS` para `luizanunciostoca/toca-mcp-server:main`.

## 7. Configuração e rollout seguro

As variáveis de autonomia foram documentadas em `.env.example`. Os defaults são fail-closed: readiness vazio, provider health vazio, modo supervisionado e nenhum kill switch granular ativo. Para qualquer side effect, o ambiente deve fornecer readiness completo e health correspondente ao tenant/provider.

A sequência obrigatória de rollout é: merge via PR com checks verdes; deploy do candidato sem ampliar autonomia; readiness e smoke provider-backed; shadow com pelo menos dez decisões e agreement exato; cinco ações externas supervisionadas com readback; canary; decisão humana; e somente então eventual classe pré-aprovada. Qualquer divergência, falha de SLO, circuito aberto, readiness vermelho ou incidente crítico recomenda rollback para `SUPERVISED_AUTO`.[3]

## 8. Gates executados

| Gate                                 | Resultado                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Prettier                             | Pass                                                                          |
| Architecture e infrastructure checks | Pass                                                                          |
| Effective autonomy policy            | Pass                                                                          |
| Capability validation evidence       | Pass, com `validations=0`                                                     |
| Main branch desired state            | Pass remoto com readback, cinco contexts                                      |
| ESLint                               | Pass                                                                          |
| TypeScript typecheck                 | Pass                                                                          |
| Vitest                               | 204 arquivos e 999 testes aprovados; 17 arquivos/25 testes externos ignorados |
| TypeScript build                     | Pass                                                                          |
| Provider-backed acceptance           | Não executado: credenciais/infraestrutura indisponíveis                       |
| GitHub push/PR/protection readback   | Pass: branch publicada, PR #281 verde e proteção da `main` verificada         |
| GCP deploy/readiness/readback        | Não executado: sessão GCP indisponível                                        |
| TOCA OS Drive writeback              | Não executado: conector de escrita indisponível nesta tarefa                  |

## 9. Próximas ações externas obrigatórias

A primeira ação restante é obter a aprovação humana exigida e realizar o merge pelo [PR #281](https://github.com/luizanunciostoca/toca-mcp-server/pull/281), sem bypass administrativo. A segunda ação é executar o pipeline de deploy com GCP autenticado sem habilitar publicação direta. A terceira é produzir evidence packages provider-backed, um por capability, somente após write real e readback no exact-head. A quarta é sincronizar este documento e os artifacts no TOCA OS Drive.

Até esses passos serem comprovados, a política correta é manter capabilities externas em `PLANNED`, classes pré-aprovadas vazias e autonomia externa no máximo supervisionada.

## Referências

[1]: ../../control/effective-autonomy-policy.v1.json 'Política efetiva de autonomia'
[2]: ../../src/core/autonomy-gate.ts 'Autonomy Gate central'
[3]: ../../src/governance/autonomy-rollout.ts 'Shadow, canary e promoção humana'
[4]: ./autonomy-readiness-acceptance-evidence-2026-08-26.json 'Artifact local do gate oficial completo'
[5]: ../../src/governance/capability-validation-evidence.ts 'Evidence package provider-backed'
[6]: ../../src/scheduler/scheduler-watchdog.ts 'Watchdog do scheduler'
[7]: ../../src/scheduler/scheduler-reconciler.ts 'Reconciliador independente'
[8]: ../../src/core/failure-containment.ts 'Matriz de contenção de falhas'
[9]: ../../.github/workflows/autonomy-safety.yml 'Workflow Autonomy Safety'
[10]: ../../control/github-main-branch-protection.v1.json 'Desired state da proteção da main'
[11]: https://docs.github.com/rest/branches/branch-protection 'GitHub REST API — protected branches'
