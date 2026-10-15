# TOCA OS — AGENTE 09: Analytics e aprendizado com prova canônica

**Artefato:** contrato de projeção analítica READONLY, não evidência de implantação nem de acesso ao Meta Graph. **Repositório:** `luizanunciostoca/toca-mcp-server`. **Agenda externa:** tarefa ChatGPT existente `TOCA 09 — Analytics`, a cada hora em `America/Bahia`; NÃO criar ou editar agendamento.

## Fontes de autoridade

- Meta Ads: somente TOCA Core/MCP `meta_ads.insights.get`, `src/registry.ts`, `src/tools/register-meta-ads-read.ts`, `src/providers/meta-ads/meta-ads-read-provider.ts` → Meta Marketing API/Graph; requer `ads_read`, conta, gateway, binding, janela, moeda e readback reais. Sem Adplane/Windsor.ai/fallback. `toca-media-server` não é um serviço/repositório autônomo confirmado.
- Instagram Feed, Story e Reel: provider via TOCA Core, conta/media ID, janela e métrica realmente retornada. Status do Drive e aprovação NÃO provam publicação nem alcance.
- CRM: somente Core/CRM, com ID de campanha, correlação, janela e readback. Compras e clientes distintos exigem CRM/financeiro, não evento `actions` da Meta.
- Conteúdo: Drive canônico `TOCA_AI_NATIVE` e `CONTENT_ITEMS`, `EXECUTION_LOG`, `SCHEDULER_EXECUTION_LOG`, `SCHEDULER_STATE` do Marketing Autopilot; nunca inferir `PUBLISHED_VERIFIED` por `PRODUCED`, `APPROVED` ou `CANARY_READY`.
- Autoridade operacional: issues #639 (claim/lock), #640 (fila/main), #641 (evidência), #642 (backlog), #985 (escopo/aprovação). Não criar Control Plane, scheduler, escritor ou integração AG01→ChatGPT Tasks paralelos.

## Implementação limitada e segura

O módulo `src/measurement/agent09-evidence-analytics.ts` implementa `analyzeAgent09Evidence` como **função pura**, sem I/O nem mudança de providers, usuários, campanhas ou publicações. Ele somente recebe evidências previamente obtidas e verificadas pelos leitores canônicos. Por isso **IMPLEMENTED** (se integrado em main) não equivale a integração ao runtime, conexão à Meta, tarefas executadas ou prova de produção.

1. Ausência de gateway, conta, token/scope, readback ou envelope => `METRICS_NOT_PROVEN`, jamais `0`. Uma resposta `data: []` não certifica ausência de venda, lead ou gasto no CRM.
2. Dedupe da mesma entidade Meta por `level/id/dateStart/dateStop`, rejeitando valores contraditórios, datas erradas e mistura de níveis que duplicaria valores. Alcance agregado de várias campanhas não pode gerar frequência única sem regra de união de usuários.
3. CTR = cliques/impressões, frequência = impressões/alcance **somente para entidade individual**, CPL = gasto/leads CRM somente sob matching de conta/campanha/janela/moeda; denominador 0 ou ausente => `null`.
4. Receita e ROAS somente com CRM/financeiro conciliados, mesma conta/campanha/correlação/moeda/janela e recibo independente de conciliação financeira; quando houver missão temporária ativa, também exige correlação com ela; Meta `actions` não representa receita, pedidos pagos nem clientes distintos.
5. Slot no passado sem ACK de ID+permalink real => **resultado desconhecido a reconciliar**, não falha provada ou autorização para retry/backfill. Duplicatas de linhas por content ID/horário não viram múltiplos posts.
6. AG-01 temporário só com owner, route, account, campaign, correlation, autorização e janela comprovados; caso contrário mantém análise NORMAL. Finalizada janela, retorna ao normal sem modificar tarefas.
7. No máximo **uma** recomendação por ciclo, com fato, risco, confiança, decisão autorizável, evidência e rollback. Fingerprint deduplica recomendações repetidas; hash não é lease ou chave de idempotência. Limiares de fadiga 3/1% são **triagem fraca**, não instrução de pausar.

## Ordem de revisão e gates

- P0: slots sem provider ACK após janela, consultar apenas GET oficial antes de concluir falha ou propor reprocessamento (owner da publicação é AGENTE 10 / publicador único).
- P1: sem binding Meta real, marcar `METRICS_NOT_PROVEN`, não comprar trial de terceiro nem substituir fonte; `ACTIVE` com gasto verificado zero demanda diagnóstico de entrega/faturamento, não 'sucesso'.
- P2: se AG-01 estiver autorizado, comparar campanha/adset/ad e creative/copy somente com relatórios compatíveis, sem write ou aumento de orçamento.
- Não registrar PII, token, payload Graph bruto ou credenciais no GitHub; nenhum DM/Comment, Story, Feed, provider write, IAM, DB, financeiro, Slack, Google Ads, WhatsApp, SendGrid ou Render.

## Para efetiva integração e prova de operação

É obrigatório obter claim/exclusive lane quando houver hotspot, revisão independente, exact-head Quality/Autonomy/Security e readback de merge. Só então o runtime Core poderá usar a função via adaptador canônico que entregue observações normalizadas, sem criar novo scheduler nem novo gateway. A tarefa ChatGPT agendada NÃO importa nem executa código de um PR automaticamente. Provider prova exige execução real do Core com account/scopes e resultado Meta/IG/CRM efetivo. Sem isso, classificar **INTEGRATION_NOT_PROVEN / RUNTIME_NOT_PROVEN**, independentemente do estado do código.

Links: [#639](https://github.com/luizanunciostoca/toca-mcp-server/issues/639), [#640](https://github.com/luizanunciostoca/toca-mcp-server/issues/640), [#641](https://github.com/luizanunciostoca/toca-mcp-server/issues/641), [#642](https://github.com/luizanunciostoca/toca-mcp-server/issues/642), [#985](https://github.com/luizanunciostoca/toca-mcp-server/issues/985).