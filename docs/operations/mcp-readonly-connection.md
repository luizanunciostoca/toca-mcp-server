# MCP: preparação da conexão somente leitura

Status: **NOT_INTEGRATED**. Diagnóstico de fonte, sem implantação ou credenciais.

## Execução local

```sh
node scripts/check-mcp-readonly-connection.mjs
pnpm exec vitest run test/mcp-readonly-connection.test.ts test/app-gateway-oidc-verifier.test.ts
```

O script não usa rede, lê apenas seis arquivos de fonte fixos, registra seus SHA-256 e retorna exit 2 intencionalmente: nenhuma inspeção estática pode certificar conexão ativa. Fonte ausente ou handoff diferente do conhecido retorna UNKNOWN_REQUIRES_REVIEW, nunca PASS. Não utilizar como Quality gate obrigatório. Os testes usam somente loopback e fixtures; não criam credenciais válidas em serviço real.

## Resultado da inspeção

Na base `08b5b585c5a3a4630738b660078ed1bc69ab19c0`, `src/http-server.ts` configura o SDK sem um verificador de bearer e normaliza requisições sem preservar req.auth. O SDK MCP 2.0.0 não transforma Authorization em AuthInfo automaticamente. O Core já resolve identidade em `src/core/identity.ts` e `src/runtime/tenant-identity.ts`.

O verificador RS256/JWKS existente em `src/app-gateway/oidc-verifier.ts` pode ser reutilizado, mas seu uso no App Gateway é opt-in e não está conectado em `src/http.ts`. Não é preciso outro orquestrador.

A identidade de fallback de serviço em `src/server.ts` depende de NODE_ENV=production, MCP_ENABLED e K_SERVICE. Ela permite capabilities limitadas de agendamento e varia com configuração de publicação direta. Não é identidade caller-bound de leitor. Uma descoberta/health bem-sucedida não prova autenticação; o transporte stdio também não resolve a conexão remota.

Os testes demonstram bearer sem contexto, perda de contexto pela normalização, passagem explícita suportada pelo SDK, rejeição de escrita/escopo/expiração/tenant ambíguo e distinção do fallback. As fixtures não simulam OAuth em produção.

## Decisões mínimas antes de implementar a conexão

### 1. Transporte disponível para esta conta

No navegador do tablet, verificar a opção em [Plugins do ChatGPT](https://chatgpt.com/plugins), botão +, Add custom MCP server. A documentação oficial permite Server URL ou Tunnel, com autenticação configurada; permissões do workspace e restrições de segurança continuam valendo. Isso não comprova elegibilidade desta conta, disponibilidade no app móvel ou exposição da ferramenta nesta conversa dot. Criar/instalar só após escopo e acesso aprovados.

Fonte: [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server), consultada em 15/10/2026.

- **Server URL:** exige endpoint MCP alcançável por esse cliente e fronteira autenticada aprovada. Não tornar o Core privado anônimo para preencher esse campo.
- **Tunnel:** candidato para alcançar backend privado; exige verificar disponibilidade/roles/runtime da conta. Não assumir que o túnel resolve identidade TOCA, IAM ou readonly por si só. Provisionamento e credencial persistente são etapas separadas, não executadas.

### 2. Identidade canônica

Solicitar ao responsável, sem segredos: issuer exato, audience/resource pretendido, JWKS público autorizado, mecanismo de login suportado, identificador estável de cliente/sujeito e sua associação aprovada ao tenant/workspace/organização TOCA.

Reaproveitar `createOidcBearerVerifier` apenas se o provedor escolhido fornecer tokens RS256 compatíveis. O componente verifica identidade; não fornece sozinho servidor OAuth, registro de cliente, descoberta OAuth ou grant de acesso. Não confundir um ID token de invocação Cloud Run com access token OAuth do usuário. Se o IdP usar outro formato, a decisão precisa ser explícita antes de substituir o verificador.

Criar um mapeamento server-side, autorizado e mínimo do sujeito verificado para os escopos já reconhecidos pelo Core. Para a primeira etapa: `toca:read`, tenant/workspace/organização explícitos e capabilities/contas aprovadas. Não confiar em tenant, roles ou scopes fornecidos no corpo da chamada. Não usar principal de serviço compartilhado para simular usuário. Não escolher unilateralmente se o sujeito ou client_id será a chave estável da identidade MCP: o modelo atual forma `mcp-client:<clientId>` e o isolamento entre usuários precisa ser preservado.

### 3. Binding e superfície realmente somente leitura

Depois de lane/locks e autorização de publicação de fonte, adicionar o binding mínimo entre verificador existente e handler existente. Rejeitar autenticação inválida antes do handler, preservar o AuthInfo verificado na normalização e impedir downgrade para fallback de serviço no caminho destinado a leitores. Não apenas copiar o header para req.auth.

Restringir **no servidor** o conjunto de ferramentas expostas e chamadas. Para o primeiro teste, permitir apenas `toca.system.health`, `toca.capabilities.search` e `toca.capabilities.describe`; nenhum acesso de negócio é provado por isso. Acrescentar leitura de dados somente com identidade, escopo e política específicos. `readOnlyHint` e seleção de ferramentas na UI são metadados/controles auxiliares, não substitutos de autorização. `toca.execute` é genérico e não deve ser liberado inteiro porque algumas capabilities são READ. Workflow create/advance, approval request e geração continuam fora da primeira etapa.

## Runbook de aceitação futura, sem execução neste pacote

1. Revalidar main, PR #1059, claims #639 e fila #640. Não tomar os locks de AG01 ou webhook. Registrar a lane de fonte e os caminhos exatos antes de editar o repositório.
2. Fazer readback **de metadados**, por acesso já autorizado: projeto, região, nome do serviço Core, URL efetiva, ingress/default URL, IAM sem membros públicos, revisão com tráfego, SHA e digest. O default de deployment é serviço `toca-mcp-production`, projeto de mesmo nome; variáveis podem substituir os nomes. A URL exata continua desconhecida e deve vir desse readback. O endereço AG01 `/execute` não é `/mcp`; não montar URL por adivinhação.
3. Confirmar a identidade/acesso do cliente e o binding server-side acima. Não gerar tokens, expandir IAM ou instalar túnel sem autorização específica. Quem usa só tablet pode completar consentimento pelo navegador; não exigir shell no dispositivo.
4. Em ambiente autorizado, validar rejeição sem credencial/inválida/expirada; cliente de outro tenant; capability não concedida; tentativa de escrita. Testes negativos de escrita devem usar dependências fake ou staging seguro, nunca uma chamada potencialmente mutante em produção para fabricar evidência.
5. Validar initialize, versão negociada, tools/list completo e superfície reduzida; depois health/ready separadamente. `toca.system.health` informa composição de stores, não prova login nem banco durável. `/readyz` e descoberta não provam provider ou autorização do usuário.
6. Somente com a leitura de negócio autorizada, executar uma capability READ específica por caminho governado, usando conta/tenant conhecidos; registrar resultado sanitizado, correlation/execution IDs e evidência do provedor se aplicável. Falta de dados não é zero. Uma leitura pode gerar audit interno; definir previamente esse escopo.
7. Provar isolamento do leitor e ausência de alteração de configuração/provider. Não criar missão nesta fase: persistir WorkflowStore é fase separada, mesmo com ação final READ.
8. Registrar SHA/revisão/identidade/escopo/tempo das provas. Reexecutar evidência afetada quando qualquer desses mudar. Só declarar conectado após a ferramenta instalada ficar disponível e completar a chamada real nesta conversa autorizada.
