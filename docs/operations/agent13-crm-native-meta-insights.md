# TOCA OS — Agente agendado 13: CRM, Leads e Funil

**Estado documental:** contrato de fonte e comportamento; não é prova de runtime do provedor.
**Base auditada:** `luizanunciostoca/toca-mcp-server`, `d4dad13cdae4ff720a572adfe63f5d3d4f88b1a1` (14/10/2026).
**Escopo:** tarefa horária **TOCA 13 — CRM e Leads** em `America/Bahia`. Esta tarefa **não** é o cargo histórico `AG-13 — Pessoas e Cultura` descrito nos perfis institucionais.

## Fonte única de métricas de mídia paga

- Utilizar exclusivamente a capability nativa `meta_ads.insights.get` do TOCA Core/MCP (`src/registry.ts`, `src/tools/register-meta-ads-read.ts`, `src/providers/meta-ads/meta-ads-read-provider.ts`) vinculada à **Meta Marketing API / Graph**.
- `toca-media-server` é um nome fornecido em solicitação operacional, **não** um repositório/endpoint acessível confirmado. O repositório verificado é `luizanunciostoca/toca-mcp-server`. Não construir URL a partir de nome presumido.
- **Proibido utilizar Adplane ou Windsor.ai**, inclusive como fallback, exemplo de conexão ou solução para indisponibilidade do Core. Encerramento de trial de terceiro não constitui falha do pipeline canônico e não exige assinatura.
- A rota de leitura nativa requer `ads_read`, conta de anúncios e credenciais válidas, feature flag/binding do runtime. Registro `IMPLEMENTED` e testes não provam que o gateway esteja conectado agora.
- Falhas de autenticação, rota, rede, falta de `data` na resposta e ausência de binding devem ser reportadas como **METRICS_NOT_PROVEN / UNAVAILABLE**, nunca como conversões ou gastos zerados. `data: []` é um array vazio válido para a consulta delimitada, mas não uma prova independente de ausência de vendas no CRM.

## CRM comercial, atribuição e privacidade

- Fonte de verdade de lead, consentimento, estágio, deduplicação, progresso comercial e entrega: **CRM/Core**, por seus registros canônicos. Um evento `actions` atribuído pela Meta **não** comprova cliente distinto, venda paga ou receita.
- Correlacionar somente `campaignId`, `correlationId`, `routeId`, origem, IDs de evento/idempotência e janela temporal quando puderem ser demonstrados pelas respectivas fontes. `AG-01` não confere assignment à tarefa ChatGPT sem protocolo e ACK de execução reais.
- Em campanha aprovada e vigente, priorizar temporariamente análises **agregadas** dos leads atribuíveis; depois retornar ao CRM geral, sem alterar a definição da tarefa.
- Toda leitura registra: conta efetiva, `level`, campos solicitados, período `since/until`, `America/Bahia`, moeda efetiva, fonte, timestamp da observação, identidade/correlação disponível e limites de comprovação.
- Distinguir `0` recebido e validado de `null`/dado ausente; não preencher gastos, leads, purchases, ROAS ou receita por inferência. Receita/conversão concluída exige conciliação CRM ou evidência financeira autorizada.
- PII mínima e dados de contato protegidos; nunca publicar dados pessoais, tokens, segredos ou payloads brutos em issues, logs públicos e relatórios abertos.

## Fronteiras de execução

- Tarefa horária = diagnóstico e supervisão **READONLY por padrão**. Não enviar DM, comentário, e-mail, WhatsApp, Slack, cold outreach, remarketing sem consentimento ou outros disparos.
- Respostas reativas Direct/Comment cabem **exclusivamente** ao serviço canônico orientado por **evento**.
- Metadados de CRM só podem ser escritos pelas APIs canônicas com claim, escopo e autorização concretos. Controle de WIP: 1 agregado de campanha por vez. Sem alteração: silêncio.
- Proibidos novos publicadores/filas paralelas, Google Ads, SendGrid, Render, e gastos ou mutações DB/IAM não autorizadas.
- Source-commit, testes, integração, runtime e confirmação da Meta são **evidências diferentes**; publicar fonte no GitHub não ativa nem certifica o serviço.

## Referências canônicas

- [Capacities de Meta Ads](../../src/registry.ts), [registro da rota](../../src/tools/register-meta-ads-read.ts) e [provider read-only](../../src/providers/meta-ads/meta-ads-read-provider.ts).
- [CRM Core](../../src/crm/crm-records.ts), [modelo de Analytics](../../src/measurement/analytics-read-models.ts).
- [Control Plane #639](https://github.com/luizanunciostoca/toca-mcp-server/issues/639), [Fila #640](https://github.com/luizanunciostoca/toca-mcp-server/issues/640), [Evidências #641](https://github.com/luizanunciostoca/toca-mcp-server/issues/641), [Backlog #642](https://github.com/luizanunciostoca/toca-mcp-server/issues/642), [Autorizações #985](https://github.com/luizanunciostoca/toca-mcp-server/issues/985).
