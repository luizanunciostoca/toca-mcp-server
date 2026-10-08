# Auditoria de rejeição — Story Sunset SUN-0263

**Peça auditada:** `2026-08-27_SUNSET_STORY_1100_SUN-0263_STORY_APPROVAL_V1.0.png`  
**Fotografia:** `SUN-0263` — drink em primeiro plano, luminárias, árvores, céu azul, pessoas e mesas  
**Template declarado:** `SUNSET_REF_10_INFO_TOP_LOGO` / `INFO_HOURS_TOP_LOGO`  
**Benchmark solicitado pelo usuário:** referência `66698419-A7D5-4DD9-A042-A656D61F7552.png`  
**Resultado:** `REJECTED_REFERENCE_MISMATCH`

## 1. Conclusão

A peça não é uma cópia fiel de nenhum dos padrões enviados. Ela combina alguns elementos gerais da biblioteca — fotografia full-bleed real, tratamento quente, horário em caixa laranja, tipografia Bodoni/Didot + sans e logos oficiais — mas não reproduz a composição, a escala, a ordem e o peso visual do anexo indicado.

O problema central não foi a fotografia nem a legibilidade. A checagem de sobreposição passou e os elementos importantes foram protegidos. O problema foi **fidelidade de template**: o sistema escolheu uma composição funcional com logo Toca no topo e footer reduzido, enquanto o anexo de referência exige uma peça de campanha mais ampla, com headline dominante, estrutura gráfica laranja/apoio e assinatura de rodapé equivalente ao modelo visual escolhido.

## 2. O que está correto

| Item                   | Resultado | Observação                                                                                         |
| ---------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| Fotografia             | PASS      | A foto real `SUN-0263` foi preservada; drink, mão, luminárias e pessoas não foram redesenhados.    |
| Proporção              | PASS      | Canvas vertical 1080 × 1920.                                                                       |
| Área protegida         | PASS      | O headline foi colocado no céu, sem cobrir o drink, a mão ou as pessoas.                           |
| Contraste local        | PASS      | O título ficou branco sobre o campo azul escuro.                                                   |
| Horário                | PARCIAL   | Existe caixa laranja no topo, mas a escala e a relação com os outros elementos não seguem o anexo. |
| Logos                  | PARCIAL   | Foram usados assets oficiais, mas o modo de assinatura é de outro template.                        |
| Tratamento fotográfico | PARCIAL   | O grade quente/azul é coerente, mas a peça não incorporou a estrutura gráfica do benchmark.        |

## 3. Erros de aderência visual

|   # | Erro                                                                             | Severidade | Evidência na peça                                                                                                                                                                      | Regra/padrão que deveria ter sido seguido                                                                                                                     |
| --: | -------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | **Template errado ou híbrido**                                                   | Crítico    | A peça declara `INFO_HOURS_TOP_LOGO`, mas foi solicitada a linguagem da referência `66698419...`, que pertence à família `INFO_HOURS_ORANGE` com bloco laranja e headline de campanha. | O sistema deve usar uma referência explícita; não pode misturar assinatura superior de um template com hierarquia de outro.                                   |
|   2 | **Headline pequena e confinada à direita**                                       | Crítico    | “PÔR DO SOL na Toca” aparece estreito, no canto superior direito, sem dominar a peça.                                                                                                  | No benchmark, a headline é o principal elemento gráfico, grande, com presença central ou em uma área de campanha claramente definida.                         |
|   3 | **Headline não ocupa o espaço livre de forma compositiva**                       | Alto       | A safe region foi escolhida apenas por não intersectar elementos protegidos; ela não foi calibrada pela composição visual do anexo.                                                    | Área segura não é apenas área vazia: deve ter dimensão, alinhamento, escala e posição equivalentes ao template de referência.                                 |
|   4 | **Ausência do bloco/estrutura laranja do benchmark**                             | Crítico    | O arquivo tem somente a caixa laranja do horário; não há transição ou painel laranja organizando a mensagem.                                                                           | Na referência `66698419...`, o laranja é parte estrutural da campanha, não apenas um badge.                                                                   |
|   5 | **Apoio textual ausente**                                                        | Alto       | O texto de apoio previsto para o slot, “Seu ritual começa aqui.”, não foi renderizado.                                                                                                 | As referências que usam apoio tratam-no como strip branco individual ou faixa de contraste; o sistema não pode simplesmente eliminá-lo.                       |
|   6 | **CTA ausente**                                                                  | Alto       | Não existe uma ação visível na peça.                                                                                                                                                   | O template de campanha deve manter um CTA outlined quando o slot possui CTA; a ausência precisa ser uma decisão registrada, não uma omissão.                  |
|   7 | **Ordem tipográfica incompatível com o benchmark escolhido**                     | Alto       | “PÔR DO SOL” foi composto em sans funcional e “na Toca” em serif secundária.                                                                                                           | Para o modelo editorial/hero do anexo, a headline aspiracional deve usar a serif Bodoni/Didot; sans pesada fica restrita a horário e mensagem funcional.      |
|   8 | **Logo Toca no topo sem correspondência ao anexo escolhido**                     | Alto       | A peça usa o logo Toca como assinatura superior e reduz o footer a Corona, Red Bull e Morro Digital.                                                                                   | Esse modo é permitido pelo template `INFO_TOP_LOGO`, mas não deve ser usado quando o benchmark selecionado exige assinatura institucional completa no rodapé. |
|   9 | **Footer visualmente menor e diferente**                                         | Médio      | O rodapé apresenta três marcas pequenas, enquanto o padrão de referência indicado apresenta uma assinatura de campanha mais equilibrada e, quando não há logo superior, quatro logos.  | `footer_mode` precisa ser derivado da referência, não escolhido somente pela presença de qualquer logo no topo.                                               |
|  10 | **Composição excessivamente assimétrica sem intenção equivalente ao anexo**      | Alto       | Todo o texto foi empurrado para o extremo direito, criando uma coluna isolada e deixando o restante da peça sem estrutura gráfica.                                                     | Assimetria só deve ser usada quando corresponde à referência escolhida e à geometria da fotografia; não pode ser consequência de uma safe region estreita.    |
|  11 | **O template foi selecionado pelo tipo de conteúdo, não pela referência visual** | Crítico    | A foto de drink levou automaticamente ao modo `INFO_HOURS_TOP_LOGO`, embora a referência solicitada seja um layout específico de campanha laranja.                                     | A escolha deve considerar `reference_template_id` + objetivo + fotografia + safe regions; o tipo “drink” sozinho não determina o layout.                      |
|  12 | **Quality Gate incompleto**                                                      | Crítico    | A peça passou em `overlap_check` e `contrast_check`, mas isso não mediu escala, ordem, proporção, presença de elementos obrigatórios ou semelhança com o benchmark.                    | O gate precisa incluir `reference_similarity_check`, `required_element_check`, `typographic_role_check`, `footer_mode_check` e `template_purity_check`.       |

## 4. O que não deve ser considerado erro

A ausência de texto sobre o drink, a mão, os rostos e as luminárias está correta e deve ser preservada. O contraste branco no céu azul escuro também está correto segundo a regra adaptativa. O uso de Bodoni Moda e Montserrat como candidatas de runtime é tecnicamente coerente com a identificação visual, embora o nome exato das fontes ainda não esteja comprovado pelo arquivo editável original.

## 5. Causa sistêmica

A biblioteca de templates foi criada, mas o compositor ainda não foi convertido em um motor de **template puro**. O código de produção aceita uma família nominal, mas não obriga correspondência visual integral entre referência e saída. O safe-zone check verifica somente colisão geométrica; não verifica se o espaço livre possui a mesma função, escala e hierarquia do benchmark. Além disso, a composição da nova peça foi codificada diretamente em um script específico, sem um objeto de layout que contenha a ordem dos elementos, escala relativa, largura máxima, modo de footer, presença obrigatória de CTA e regra de tipografia da referência.

A correção necessária é separar três decisões: primeiro, selecionar explicitamente a referência; segundo, analisar a fotografia e escolher a safe region dentro da gramática daquela referência; terceiro, renderizar todos os elementos obrigatórios do template ou bloquear a peça. Uma peça que passa apenas em “não cobriu o produto” ainda deve ser reprovada se não parecer uma aplicação do template selecionado.

## 6. Correções obrigatórias antes de qualquer nova peça

1. Exigir `reference_template_id` explícito em cada peça.
2. Proibir mistura de famílias: `INFO_TOP_LOGO` não pode usar `footer_mode` ou hierarquia de `INFO_HOURS_ORANGE` parcialmente.
3. Registrar elementos obrigatórios por template: headline, horário, apoio, CTA, bloco/strip laranja e modo de footer.
4. Adicionar validações de escala e posição relativa, não somente interseção com protected regions.
5. Adicionar `reference_similarity_check`, `template_purity_check` e `required_element_check` ao Quality Gate.
6. Fazer a peça falhar fechado quando o texto de apoio ou CTA do slot desaparecer sem decisão explícita.
7. Usar a referência `66698419...` como benchmark do template escolhido, com headline de campanha maior, estrutura laranja coerente, tipografia correspondente e assinatura de rodapé compatível.
8. Só depois da aprovação de uma peça aplicar a mesma família a outros assets; cada fotografia continua exigindo análise individual de safe regions.
