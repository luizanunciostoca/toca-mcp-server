# AG-09 — Analytics nativo TOCA / fonte Meta Ads (2026-10-14)

## Autoridade e rota executável

O AG-09 não usa **Adplane**, Windsor.ai nem outro agregador como origem ou fallback de Meta Ads. Disponibilidade de um conector do ChatGPT não comprova fonte de dados do TOCA OS.

O proprietário confirmou como repositório correto `luizanunciostoca/toca-mcp-server`. A integração Meta Ads deve permanecer neste código canônico, sem criar repositório ou serviço concorrente e sem depender de Adplane.

Rota nativa verificada no código:

`TOCA Core / MCP -> meta_ads.insights.get -> MetaAdsReadProvider.getInsights -> MetaApiClient GET -> Meta Marketing API act_{adAccountId}/insights`

Identidade do código: `src/mcp/runtime-capability-resolver.ts` (caminho Core realmente executado por `toca.execute`), `src/tools/register-meta-ads-read.ts` (registro legado/alternativo), `src/providers/meta-ads/meta-ads-read-provider.ts` e `src/providers/meta/meta-api-client.ts`. O adaptador `src/measurement/ag09-native-meta-insights.ts` acrescenta proveniência nativa, escopo, janela e distinção entre `NO_ROWS` e valores zero explícitos. A presença deste contrato **não** comprova token/conta conectados nem resposta LIVE.

Para hierarquia, utilizar `meta_ads.accounts.list`, `meta_ads.campaigns.list`, `meta_ads.adsets.list`, `meta_ads.ads.list` e `meta_ads.insights.get` com `level=account|campaign|adset|ad`. Confirmar conta alvo, permissão `ads_read`, moeda e IDs. Consulta Meta/Instagram não deve usar endpoints de escrita.

## Fontes por domínio

- **Meta Ads:** leitura direta da Graph API pelo TOCA MCP/Core e respectivos provider IDs e janelas; nenhuma rota Adplane.
- **Instagram Feed/Stories/engagement:** provedores Instagram nativos do TOCA e `provider_publications`, com readback para `PUBLISHED`; não confundir publicação agendada com efetivada.
- **CRM/leads e revenue:** CRM e Measurement canônicos; vendas apenas com pedidos/ticketing/payment realmente conciliados, moeda e vínculo de atribuição demonstrados.
- **Contexto e políticas:** Drive `TOCA_OS`, `TOCA_AI_NATIVE`, `CONTENT_ITEMS`, Marketing Autopilot e GitHub PRO+ v2 #639–#642; GitHub define código, não é prova de entrega no provider.

## Ciclo AG-09

Fuso de apresentação: `America/Bahia`; preservar também fuso da conta do provider quando comprovado. Não deslocar ou agregar datas do Meta ad-account por suposição.

Ciclo normal horário: publicação, engagement, leads, alcance, CTR, frequência, investimento e CPL com escopo/denominador. Ciclo temporário de campanha autorizado por AG-01: acompanhar campanha/conjunto/anúncio e janela, comparar creative/copy/audience, detectar fadiga, atribuição fraca e sinal de stop/pause; retornar automaticamente ao painel normal após o encerramento confirmado. Não editar nem duplicar a definição de tarefas ChatGPT.

Identificar cada janela por `provider + account + level + entity IDs + dates + breakdown`. Descarta-se duplicata apenas quando **ID da entidade do nível consultado e limites de data estão presentes**, e o JSON completo (com chaves canônicas) é igual. Sem identidade suficiente, preservar linhas mesmo com valores aparentemente iguais, evitando perder campanhas/conjuntos/anúncios distintos. A ausência de linha de insights é `NO_ROWS` e **não** investimento 0. `spend=0` explícito pode ser valor real, mas `ACTIVE + spend=0` é hipótese para reconciliação de entrega/conta/janela, jamais sucesso.

Taxas exigem denominador válido. Eventos `actions` da Meta não equivalem automaticamente a leads qualificados, conversões financeiras ou revenue CRM. ROAS só é exibível com gasto e receita realizados, mesma moeda, atribuição conciliada e janela compatível; caso contrário `NOT_PROVEN`. Não inventar metas, orçamento, período, histórico, vendas ou campanha.

## Formato obrigatório da recomendação

Por rodada emitir **no máximo uma análise prioritária** e permanecer em silêncio se não houver mudança relevante. Quando emitir, incluir:

- `provider`, `account_id`, `reporting_timezone`, `provider_account_timezone` (se comprovado), `since`, `until`, `observed_at`, `level`, `campaign/adset/ad IDs`;
- observações com unidade, denominação, valor explícito ou `UNAVAILABLE/AMBIGUOUS/NOT_PROVEN`, fonte/evidência e frescor;
- risco, confiança, hipótese/alternativa, recomendação concreta ao AG-03/planejador e ao núcleo de Meta Ads;
- `decision_allowed=RECOMMEND_ONLY`, aprovação necessária para qualquer ação governada pelo Core, critério de validação e condição de rollback;
- resultado `write_executed=false`.

O AG-09 nunca ativa, pausa, altera budget, publica, responde Direct/Comment, escreve em banco ou finanças, nem inicia gasto. Qualquer mutação de anúncio pertence ao Core/R28, com ApprovalRecord, teto financeiro quando necessário, idempotência e readback. Não despachar Slack, Google Ads, WhatsApp, SendGrid ou Render.

## Provas e regressões

Testar fonte nativa única e erro sem fallback externo; wrong-account, data inválida/invertida, vazio distinto de zero, deduplicação exata sem mistura de breakdowns, ausência de revenue, e nenhuma escrita. Testes com mocks provam somente código: conexão Meta LIVE requer evidência adicional e verificável por ambiente/conta/janela.
