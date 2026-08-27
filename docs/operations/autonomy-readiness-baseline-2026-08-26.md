# Baseline de Autonomia e Readiness — 2026-08-26

**Autor:** Manus AI  
**Exact-head auditado:** `904210f2ed000ac1f99783d5f210e58da938e775`  
**Classificação:** engenharia, segurança operacional e governança

## 1. Síntese executiva

O exact-head auditado passa o gate local oficial `pnpm quality` com Node 24: formatação, checks arquiteturais, lint, typecheck, 194 arquivos de teste aprovados, 17 arquivos de teste ignorados por dependerem de ambientes externos, 943 testes aprovados e build TypeScript concluído. Os workflows públicos **Quality Gate** e **Security Supply Chain** também concluíram com sucesso no mesmo SHA.[1] [2]

O estado ainda não autoriza ampliar autonomia externa. O commit registra literalmente `PRODUCTION_DEPLOY_EXECUTED=NO`; uma execução posterior de **Deploy GCP Next** para o mesmo SHA falhou no passo `Verify production webhook health readiness and route confinement`, antes da promoção de tráfego.[3] [4] A API pública informa `main.protected=true`, porém `protection.enabled=false`, sem contexts/checks obrigatórios; a leitura detalhada das regras requer autenticação.[5]

A política oficial do Marketing Autopilot no TOCA OS já foi reconciliada para **TOCA_MANAGED_SCHEDULING**, define os três níveis efetivos de autonomia e descreve Autonomy Gate, Readiness Gate, modos graduais, shadow, canary, kill switches, circuit breakers, watchdog e reconciliação.[6] O runtime ainda contém a semântica antiga `NATIVE_PROVIDER_SCHEDULING_ONLY`, não possui artifact `effective-autonomy-policy` e promove capabilities diretas `instagram.publish.*` para `PRODUCTION_VALIDATED` apenas por configuração de runtime, sem exigir evidence package individual provider-backed.[7] [8]

> **Decisão de baseline:** nenhuma capability externa, classe pré-aprovada, branch rule ou implantação deve ser promovida por inferência. O trabalho desta branch deve fechar contratos e testes primeiro; as mutações de GitHub, Drive, GCP e Meta somente podem ocorrer com acesso autenticado, gates verdes e evidência do exact-head.

## 2. Estado verificado

| Domínio               | Estado                       | Evidência                                                                                                                                                                                          | Consequência                                                                                                                |
| --------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Política do Drive     | Reconciliada                 | `TOCA_MANAGED_SCHEDULING`, níveis efetivos, gates e modos graduais constam na política v1.1.[6]                                                                                                    | O código deve derivar artifacts e comportamento dessa política.                                                             |
| Scheduling runtime    | Contraditório                | `src/marketing-autopilot-scheduling.ts` aceita somente `NATIVE_PROVIDER_SCHEDULING_ONLY` ou `SHARE_NOW`.[7]                                                                                        | Atualizar contrato, testes e documentação para `TOCA_SCHEDULE`, preservando `SCHEDULED` para evidência nativa.              |
| Approval engine       | Forte e reutilizável         | ApprovalRecord possui SHA, escopo, conta, autoridade, reserva atômica e consumo após provider readback.[9]                                                                                         | Reutilizar; não criar segundo Approval Engine.                                                                              |
| Policy engine         | Parcial                      | `evaluatePolicy` já retorna `ALLOW`, `REQUIRE_APPROVAL` ou `DENY`, mas sem reason code estruturado, readiness agregado, health de provider, granularidade de kill switch ou modo de autonomia.[10] | Evoluir o gate central existente, preservando compatibilidade.                                                              |
| Capability lifecycle  | Evidence-aware               | Promoção para `PRODUCTION_VALIDATED` exige smoke e readback no lifecycle.[11]                                                                                                                      | Conectar registry runtime a evidence package explícito.                                                                     |
| Registry runtime      | Inseguro por inferência      | `instagram.publish.*` muda de `PLANNED` para `PRODUCTION_VALIDATED` quando writes ou scheduler estão habilitados.[8]                                                                               | Remover promoção implícita; exigir validação individual.                                                                    |
| Scheduler próprio     | Implementado                 | Descriptor SHA, aprovação, idempotência, Postgres, claim, stale recovery, retry e reconciler provider-backed já existem.[12] [13]                                                                  | Fortalecer com watchdog, health snapshot, reconciliação de estados impossíveis e métricas.                                  |
| Readiness geral       | Implementado parcialmente    | DB, migrations, schema, audit, outbox, approval, providers e configuração crítica já são verificados.[14]                                                                                          | Adicionar Readiness Gate específico do Autopilot e exact-head certification.                                                |
| Kill switch           | Somente global               | `TOCA_PLATFORM_KILL_SWITCH` bloqueia mutações e preserva reads.[10]                                                                                                                                | Adicionar scopes global, tenant, provider e capability.                                                                     |
| Shadow/canary         | Ausente no runtime           | Não há contrato nem estado operacional machine-readable.                                                                                                                                           | Implementar modo fail-closed, critérios mínimos e rollback de autonomia.                                                    |
| Watchdog              | Ausente                      | Não há métricas `last_poll`, `last_claim`, `oldest_due_job`, `execution_latency` e `publication_lag`.                                                                                              | Implementar snapshot e avaliação determinística.                                                                            |
| SLO do Autopilot      | Parcial                      | Catálogo possui publicação, provider readback e R31, mas não os indicadores específicos pedidos.[15]                                                                                               | Estender catálogo e runbook sem criar segundo sistema.                                                                      |
| Chaos/fault injection | Parcial                      | Há testes de outbox e drills, mas não a matriz completa do scheduler/publicação.                                                                                                                   | Adicionar regressões determinísticas para crash windows, 429/500, duplicate, stale approval, descriptor drift e clock skew. |
| Branch protection     | Ineficaz no readback público | `protected=true`, `enabled=false`, sem checks requeridos.[5]                                                                                                                                       | Aplicação requer acesso autenticado e deve exigir PR + checks críticos.                                                     |
| Deploy production     | Não concluído                | Deploy do exact-head falhou no readiness do webhook.[3] [4]                                                                                                                                        | Corrigir/validar a causa; não promover tráfego sem novo evidence package.                                                   |

## 3. Riscos e ordem de implementação

A sequência segura é: **contrato canônico e validator de drift → Autonomy Gate → Readiness Gate → modos graduais e controles → scheduler watchdog/reconciliação → aprovação em lote e métricas → fault injection → registry provider-backed → CI/branch protection → acceptance e deploy**. Essa ordem reduz o risco de habilitar uma capability externa antes que o sistema saiba provar por que pode agir.

| Risco                                     | Severidade | Mitigação obrigatória                                                                                        |
| ----------------------------------------- | ---------: | ------------------------------------------------------------------------------------------------------------ |
| Publicação duplicada após outcome incerto |    Crítico | Idempotência, reconciliation provider-backed e estado `FAILED_REVIEW_REQUIRED`; nunca retry cego.            |
| Autoelevação de autoridade                |    Crítico | Recomendações R31 não podem alterar `PREAPPROVED_CLASS`; promoção exige decisão humana assinada/evidenciada. |
| Divergência Drive × runtime               |       Alto | Compiler/validator gera artifact efetivo e falha o CI em decisões conflitantes.                              |
| False readiness                           |       Alto | Todos os checks obrigatórios devem estar verdes no mesmo SHA; unknown equivale a não pronto.                 |
| Capability falsamente validada            |       Alto | Registry exige evidence package individual; feature flag não prova provider support.                         |
| Kill switch amplo demais                  |      Médio | Escopos global, tenant, provider e capability, mantendo trabalho interno seguro quando possível.             |
| Deploy parcial                            |       Alto | Candidate sem tráfego, acceptance, readback, rollback target e evidence package imutável.                    |

## 4. Critérios de conclusão desta branch

Esta branch somente estará pronta para PR quando: o artifact de autonomia for validado; a policy antiga for rejeitada pelo CI; o gate central retornar decisão, reason code e evidências; readiness for fail-closed; os modos externos respeitarem shadow/canary e autoridade; watchdog e reconciliação cobrirem backlog e estados impossíveis; registry não promover publicação por flag; a matriz de falhas estiver coberta; `pnpm quality` passar; e a documentação operacional refletir o comportamento implementado.

A branch não declarará `PRODUCTION_VALIDATED`, `PREAPPROVED_CLASS`, branch protection aplicada ou deploy concluído sem readback autenticado correspondente.

## Referências

[1]: https://github.com/luizanunciostoca/toca-mcp-server/actions/runs/33007145181 'Quality Gate do exact-head'
[2]: https://github.com/luizanunciostoca/toca-mcp-server/actions/runs/33007144924 'Security Supply Chain do exact-head'
[3]: https://github.com/luizanunciostoca/toca-mcp-server/commit/904210f2ed000ac1f99783d5f210e58da938e775 'Commit exact-head 904210f2'
[4]: https://github.com/luizanunciostoca/toca-mcp-server/actions/runs/33007664086 'Deploy GCP Next #45'
[5]: https://api.github.com/repos/luizanunciostoca/toca-mcp-server/branches/main 'Readback público da branch main'
[6]: https://docs.google.com/document/d/1QvLTbwSjT2OhsTz3YkJ6rdQGeM40AgPbQNSkoj5Yb2c/edit 'Política de Aprovação do Marketing Autopilot v1.1'
[7]: https://github.com/luizanunciostoca/toca-mcp-server/blob/904210f2ed000ac1f99783d5f210e58da938e775/src/marketing-autopilot-scheduling.ts 'Semântica antiga de scheduling'
[8]: https://github.com/luizanunciostoca/toca-mcp-server/blob/904210f2ed000ac1f99783d5f210e58da938e775/src/registry.ts 'Registry runtime de capabilities'
[9]: https://github.com/luizanunciostoca/toca-mcp-server/blob/904210f2ed000ac1f99783d5f210e58da938e775/src/governance/approval-governance.ts 'Approval governance'
[10]: https://github.com/luizanunciostoca/toca-mcp-server/blob/904210f2ed000ac1f99783d5f210e58da938e775/src/core/policy.ts 'Policy engine central'
[11]: https://github.com/luizanunciostoca/toca-mcp-server/blob/904210f2ed000ac1f99783d5f210e58da938e775/src/governance/capability-lifecycle.ts 'Lifecycle de capabilities'
[12]: https://github.com/luizanunciostoca/toca-mcp-server/blob/904210f2ed000ac1f99783d5f210e58da938e775/src/scheduler/toca-managed-instagram-scheduler.ts 'Scheduler gerenciado do Instagram'
[13]: https://github.com/luizanunciostoca/toca-mcp-server/blob/904210f2ed000ac1f99783d5f210e58da938e775/src/scheduler/postgres-scheduler.ts 'Implementação PostgreSQL do scheduler'
[14]: https://github.com/luizanunciostoca/toca-mcp-server/blob/904210f2ed000ac1f99783d5f210e58da938e775/src/health/runtime-readiness.ts 'Runtime readiness'
[15]: https://github.com/luizanunciostoca/toca-mcp-server/blob/904210f2ed000ac1f99783d5f210e58da938e775/src/core/platform-slo-catalog.ts 'Catálogo de SLOs'
