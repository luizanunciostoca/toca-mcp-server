# TOCA OS — Catálogo de Templates Visuais para Stories Sunset

**Versão:** 1.0  
**Status:** `ACTIVE_DRAFT_FOR_HUMAN_APPROVAL`  
**Data da análise:** 26 de agosto de 2026  
**Fonte:** 11 referências visuais anexadas pelo Marketing  
**Objetivo:** transformar cada referência em um template reutilizável, com regras de seleção, áreas seguras, tipografia, cor, hierarquia, assinatura de marca e critérios de reprovação.

## 1. Escopo e conclusão executiva

As onze imagens anexadas não constituem um único layout. Elas formam uma **família de templates de campanha** com uma gramática comum — fotografia real full-bleed, tratamento quente, headline de alto impacto, tipografia sans funcional, CTA contornado e logos oficiais — mas com variações substanciais de ordem, posição, cor, peso gráfico e uso de blocos laranja. A principal falha do compositor anterior foi tratar essa família como uma única peça rígida.

O catálogo abaixo registra cada referência como um template individual. O sistema futuro não deverá escolher uma composição apenas pela categoria “Stories Sunset”; deverá selecionar o template pela combinação entre **objetivo do slot, tipo de fotografia, área de respiro, luminância local, presença de produto, necessidade de horário e posição do sujeito**.

> **Regra central:** a fotografia é analisada primeiro. O texto só pode ocupar uma `safe_region` comprovadamente livre e não pode intersectar uma `protected_region`. A cor do texto é determinada pela luminância da área livre: preto em área clara e branco em área escura.

## 2. Identificação tipográfica

A referência achatada permite identificar a classe visual com segurança, mas não prova o nome exato da fonte. A headline pertence à classe **Bodoni/Didot**, caracterizada por alto contraste, serifas retas e aparência editorial. A candidata de runtime recomendada é **Bodoni Moda**. Os textos funcionais pertencem à classe **Montserrat/Avenir**, com sans geométrica limpa. A candidata de runtime recomendada é **Montserrat**.

O sistema não deve declarar que essas fontes são pixel-identical sem o arquivo editável ou o pacote original da campanha. O registro deve manter `font_identity_status=VISUAL_MATCH_CANDIDATE_NOT_PROVEN_FROM_FLATTENED_PNG` até a confirmação do Brand Kit.

| Função                | Classe visual                   | Candidata de runtime       | Regra de uso                                                 |
| --------------------- | ------------------------------- | -------------------------- | ------------------------------------------------------------ |
| Headline aspiracional | Bodoni/Didot de alto contraste  | Bodoni Moda                | Title Case ou caixa normal; grande escala; uma a três linhas |
| Headline funcional    | Sans geométrica pesada          | Montserrat Semibold        | Permitida em `INFO_HOURS` para “PÔR DO SOL”                  |
| Horário               | Sans geométrica Medium/Semibold | Montserrat Medium/Semibold | Caixa alta e espaçamento controlado                          |
| Apoio                 | Sans geométrica Regular/Medium  | Montserrat Regular/Medium  | Faixas brancas individuais ou apoio mínimo                   |
| CTA                   | Sans geométrica Medium          | Montserrat Medium          | Caixa de contorno fina; uma ação por peça                    |
| Logos                 | Arte de marca                   | Arquivos oficiais white    | Nunca reconstruir como texto ou gerar por IA                 |

## 3. Regras globais que todos os templates devem herdar

Todos os templates usam canvas vertical 9:16, com fotografia real em cobertura full-bleed. O tratamento fotográfico deve preservar sujeitos, produtos, perspectiva e identidade do local. A correção de cor pode aquecer, aumentar contraste e recuperar leitura, mas não pode inserir cenário sintético nem aplicar um scrim preto global.

O sistema deve registrar, antes da composição, `reference_template_id`, `template_family`, `layout_anchor`, `safe_regions`, `protected_regions`, `headline_color`, `badge_color`, `support_mode`, `footer_mode`, `overlap_check` e `contrast_check`. A ausência desses campos deve bloquear a renderização. Se uma área livre não comportar o texto necessário, o resultado correto é `NEEDS_MANUAL_LAYOUT`, não uma redução ilegível ou uma sobreposição.

O footer padrão usa os quatro logos oficiais em branco, na ordem **Toca do Morcego → Corona → Red Bull → Morro Digital**. A assinatura pode ser reduzida para três logos quando a Toca já aparece como assinatura superior, mas essa exceção deve ser registrada no template. A faixa preta retangular pesada do compositor antigo é proibida.

## 4. Matriz de templates

| ID                                        | Referência                                 | Família                       | Papel principal           | Elemento distintivo                                                            |
| ----------------------------------------- | ------------------------------------------ | ----------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `SUNSET_REF_01_ORANGE_INFO_HOURS`         | `66698419-A7D5-4DD9-A042-A656D61F7552.png` | `INFO_HOURS_ORANGE`           | Informar Sunset e horário | Horário laranja, headline funcional/hero, bloco laranja e CTA                  |
| `SUNSET_REF_02_HERO_DARK_FOOTER`          | `79841366-D602-4109-8398-56B6DB4DE542.png` | `HERO_SERIF_DARK`             | Hero emocional            | Headline serif grande, fotografia dominante e footer sobre escurecimento local |
| `SUNSET_REF_03_ORANGE_LOWER_THIRD`        | `CD01BC5A-F359-45E8-9A64-C7E461B33DAA.png` | `ORANGE_LOWER_THIRD`          | Campanha/experiência      | Transição laranja forte no terço inferior e assinatura completa                |
| `SUNSET_REF_04_LIGHT_ORANGE_HEADLINE`     | `IMG_0350.png`                             | `LIGHT_FIELD_ORANGE_HEADLINE` | Campanha em área clara    | Headline laranja ou escura sobre campo claro                                   |
| `SUNSET_REF_05_CTA_ABOVE_HERO`            | `IMG_0604.png`                             | `FULLBLEED_CTA_TOP`           | Conversão leve            | CTA aparece antes da headline; sem bloco laranja obrigatório                   |
| `SUNSET_REF_06_SILHOUETTE_LOWER_HEADLINE` | `IMG_0965.jpeg`                            | `SILHOUETTE_LOWER_HEADLINE`   | Atmosfera/silhueta        | Strips no meio, CTA acima e headline serif no campo inferior                   |
| `SUNSET_REF_07_WHITE_STRIPS_LOWER`        | `IMG_0890.jpeg`                            | `SUPPORT_STRIPS_LOWER`        | Apoio editorial           | Faixas brancas separadas e headline inferior                                   |
| `SUNSET_REF_08_ASYMMETRIC_SUPPORT`        | `IMG_0837.jpeg`                            | `ASYMMETRIC_SUPPORT_STRIPS`   | Lifestyle assimétrico     | Área lateral livre, strips alinhados a um lado e composição não centralizada   |
| `SUNSET_REF_09_DRINK_ORANGE_BLOCK`        | `IMG_3138.png`                             | `DRINK_ORANGE_LOWER_THIRD`    | Drink/produto             | Produto preservado acima de bloco laranja forte                                |
| `SUNSET_REF_10_INFO_TOP_LOGO`             | `IMG_6170.png`                             | `INFO_HOURS_TOP_LOGO`         | Informação funcional      | Logo Toca no topo, título funcional e footer reduzido                          |
| `SUNSET_REF_11_INFO_ORANGE_BLUE`          | `IMG_2216.png`                             | `INFO_ORANGE_BLUE_ACCENT`     | Informação de campanha    | Laranja dominante com acento azul/cinza localizado                             |

## 5. Fichas individuais dos templates

### 5.1 `SUNSET_REF_01_ORANGE_INFO_HOURS`

A primeira referência é o template de informação de Sunset com maior densidade de campanha. A fotografia permanece presente, mas a metade inferior recebe um campo laranja que organiza a mensagem e cria contraste para a assinatura. O elemento de horário funciona como selo de serviço no topo; a headline deve comunicar “PÔR DO SOL” ou equivalente com presença, e o CTA fica separado dentro de uma caixa de contorno.

A headline pode ser sans funcional semibold quando a peça é estritamente informativa, ou Bodoni/Didot quando houver uma linha aspiracional secundária. O apoio deve ser curto e preferencialmente dividido em uma ou duas faixas brancas. O template deve ser escolhido quando o objetivo primário for explicar o Sunset e seu horário, e não apenas construir atmosfera.

| Campo          | Especificação                                                                       |
| -------------- | ----------------------------------------------------------------------------------- |
| Âncora         | `TOP_CENTER_TO_LOWER_CENTER`                                                        |
| Ordem          | horário → headline funcional → apoio → CTA → logos                                  |
| Área segura    | topo para horário; centro superior para headline; transição inferior para apoio/CTA |
| Área protegida | sujeito hero, rosto, mãos, produto, horizonte crítico                               |
| Cores          | laranja `#FF7A00`, branco `#FFFFFF`, dourado `#F2C17A`, preto translúcido local     |
| Footer         | quatro logos ou três quando a Toca assina no topo                                   |
| Reprovar se    | o bloco laranja apagar o sujeito, o horário perder leitura ou surgir scrim global   |

### 5.2 `SUNSET_REF_02_HERO_DARK_FOOTER`

A segunda referência é um hero emocional em que a fotografia deve dominar a peça. O texto é grande, mas não funciona como card: ele respira dentro da composição e se apoia no contraste natural da imagem. O footer é discreto e pode usar escurecimento localizado apenas na parte inferior, sem criar uma faixa preta pesada.

Este template é adequado para cenas de pessoas, encontro, música e atmosfera noturna. A headline usa Bodoni/Didot em caixa normal, enquanto o CTA contornado é centralizado próximo dela. Se a imagem já tiver uma área naturalmente escura, não se deve adicionar bloco laranja; o tratamento deve preservar essa vantagem.

| Campo          | Especificação                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Âncora         | `CENTER` ou `LOWER_CENTER`                                                                        |
| Ordem          | selo opcional → headline → apoio opcional → CTA → footer                                          |
| Área segura    | campo negativo central ou inferior escuro                                                         |
| Área protegida | faces, mãos, sujeito principal, fonte de luz                                                      |
| Cor            | branco em área escura; preto em área clara                                                        |
| Footer         | quatro logos brancos sobre escurecimento local                                                    |
| Reprovar se    | a headline cobrir rosto, a foto for escurecida globalmente ou o CTA virar botão preenchido pesado |

### 5.3 `SUNSET_REF_03_ORANGE_LOWER_THIRD`

A terceira referência é a forma mais direta de campanha com transição laranja. O laranja não é um filtro; é uma extensão gráfica do terço inferior que cria uma base para a headline e o CTA sem retirar a fotografia do papel de protagonista. O template funciona especialmente bem quando o asset tem uma área superior forte e um campo inferior que pode receber a cor da campanha.

A headline deve ser serif grande, centralizada sobre a transição. O apoio é opcional e só entra quando houver espaço suficiente. O footer institucional completo pode ser usado sobre o laranja, mas deve permanecer equilibrado e não transformar os logos em um bloco visual maior que a headline.

| Campo          | Especificação                                                                           |
| -------------- | --------------------------------------------------------------------------------------- |
| Âncora         | `CENTER_TO_LOWER_CENTER`                                                                |
| Ordem          | selo opcional → headline → apoio → CTA → footer                                         |
| Área segura    | campo negativo superior e transição laranja inferior                                    |
| Área protegida | sujeito, produto, mãos, horizonte e elementos essenciais                                |
| Cor            | headline branca sobre laranja; preta se a faixa for clara e não houver laranja saturado |
| Footer         | quatro logos brancos sobre laranja                                                      |
| Reprovar se    | o laranja invadir o sujeito sem função, cobrir produto ou ocupar o canvas inteiro       |

### 5.4 `SUNSET_REF_04_LIGHT_ORANGE_HEADLINE`

A referência `IMG_0350.png` demonstra o uso de uma área clara da fotografia como campo gráfico. Em vez de escurecer a imagem para receber texto branco, o sistema deve usar headline laranja ou preta, conforme a luminância local. O horário aparece como elemento retangular discreto e o apoio pode ser montado em faixa branca com texto laranja.

É um template de impacto para cenas de pessoas ou lifestyle com bastante respiro claro. O texto deve ser grande e econômico. A regra de contraste é especialmente importante aqui: headline e `#VemPraToca` devem ficar pretos ou laranja escuro sobre fundo claro, nunca brancos por herança de um preset global.

| Campo          | Especificação                                                                           |
| -------------- | --------------------------------------------------------------------------------------- |
| Âncora         | `TOP` ou `CENTER_NEGATIVE_SPACE`                                                        |
| Ordem          | horário/selo → headline laranja/preta → apoio → CTA → footer                            |
| Área segura    | campo claro livre no topo ou centro                                                     |
| Área protegida | rostos, mãos, highlights e sujeito principal                                            |
| Cor            | laranja ou preto sobre fundo claro; branco somente em área escura                       |
| Footer         | quatro logos brancos ou escurecimento local mínimo                                      |
| Reprovar se    | o texto branco perder contraste, cobrir o sujeito ou receber caixa preta para compensar |

### 5.5 `SUNSET_REF_05_CTA_ABOVE_HERO`

A referência `IMG_0604.png` apresenta uma ordem de leitura diferente: o CTA aparece antes da headline. Essa inversão cria uma peça de conversão leve, sem transformar a fotografia em plano de fundo subordinado. O suporte textual usa strips brancos com texto laranja ou escuro e o bloco laranja não é obrigatório.

Este template deve ser escolhido quando a ação precisa ser percebida rapidamente e a foto já possui força suficiente para sustentar a headline abaixo. O CTA deve ficar próximo do hero, mas sempre em uma safe_region própria; não deve ser colocado em coordenada fixa para todas as imagens.

| Campo          | Especificação                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Âncora         | `CENTER` ou `LOWER_CENTER`                                                                     |
| Ordem          | selo opcional → CTA → headline → apoio → footer                                                |
| Área segura    | campo livre para CTA e campo separado para headline                                            |
| Área protegida | faces, mãos, produto e sujeito hero                                                            |
| Cor            | adaptativa por luminância local                                                                |
| Footer         | quatro logos pequenos e leves                                                                  |
| Reprovar se    | CTA e headline se fundirem, a foto perder protagonismo ou surgir bloco laranja sem necessidade |

### 5.6 `SUNSET_REF_06_SILHOUETTE_LOWER_HEADLINE`

A referência `IMG_0965.jpeg` é construída em torno de silhueta e área negativa. O apoio aparece no terço médio em strips brancos com texto laranja, o CTA fica acima da headline e a headline serif ocupa a metade inferior, onde o campo escuro oferece contraste natural. O footer é quase imperceptível.

Esse template é ideal para pôr do sol, paisagem e cenas em que o sujeito pode ser preservado como silhueta. O principal risco é colocar o texto sobre a pessoa, sobre o sol ou sobre a linha do horizonte. O sistema deve tratar esses elementos como regiões protegidas antes de calcular a âncora inferior.

| Campo          | Especificação                                                 |
| -------------- | ------------------------------------------------------------- |
| Âncora         | `LOWER_CENTER`                                                |
| Ordem          | strips → CTA → headline → footer                              |
| Área segura    | campo médio para strips e campo inferior escuro para headline |
| Área protegida | silhueta, sol, horizonte, faces e mãos                        |
| Cor            | branco sobre silhueta escura; preto sobre campo claro         |
| Footer         | quatro logos brancos mínimos                                  |
| Reprovar se    | headline cruzar o sujeito, o sol ou o horizonte               |

### 5.7 `SUNSET_REF_07_WHITE_STRIPS_LOWER`

A referência `IMG_0890.jpeg` concentra sua identidade nas faixas brancas individuais. Cada linha de apoio é uma unidade independente, com separação e sombra suave. A headline e o CTA ocupam o campo inferior, mas não precisam estar centralizados; a composição pode ser alinhada à esquerda quando isso respeitar a fotografia.

O template é indicado para mensagens que precisam de contexto curto sem virar parágrafo. O renderer deve limitar o apoio a duas ou três linhas e escolher a largura de cada strip conforme o texto, em vez de criar uma caixa única de largura fixa.

| Campo          | Especificação                                                                            |
| -------------- | ---------------------------------------------------------------------------------------- |
| Âncora         | `LOWER_LEFT` ou `LOWER_CENTER`                                                           |
| Ordem          | strips → CTA → headline → footer                                                         |
| Área segura    | lateral/superior para strips; campo inferior para headline                               |
| Área protegida | rosto, mãos, drink, produto e sujeito                                                    |
| Cor            | texto laranja/escuro em strip branco; headline por contraste local                       |
| Footer         | quatro logos pequenos                                                                    |
| Reprovar se    | strips forem unidos em painel preto, a headline cobrir produto ou o apoio ficar ilegível |

### 5.8 `SUNSET_REF_08_ASYMMETRIC_SUPPORT`

A referência `IMG_0837.jpeg` mostra que a identidade visual não depende de centralização. A área lateral livre é usada para strips e o hero se posiciona em outra região, criando uma composição assimétrica. O CTA deve ficar próximo da headline, mas pode estar deslocado para acompanhar a geometria da imagem.

Esse template é importante para cenas de lifestyle em que uma pessoa, coluna, mesa ou outro elemento ocupa um lado do enquadramento. O sistema deve escolher a lateral oposta como safe_region, preservar o personagem principal e permitir que o texto tenha alinhamento à esquerda.

| Campo          | Especificação                                                                       |
| -------------- | ----------------------------------------------------------------------------------- |
| Âncora         | `TOP_LEFT`, `TOP_RIGHT`, `LOWER_LEFT` ou `LOWER_RIGHT`                              |
| Ordem          | selo opcional → strips → headline → CTA → footer                                    |
| Área segura    | campo lateral negativo detectado individualmente                                    |
| Área protegida | personagem principal, rosto, mãos e âncora arquitetônica                            |
| Cor            | adaptativa à luminância local                                                       |
| Footer         | quatro logos pequenos                                                               |
| Reprovar se    | a assimetria for destruída por centralização automática ou o personagem for coberto |

### 5.9 `SUNSET_REF_09_DRINK_ORANGE_BLOCK`

A referência `IMG_3138.png` é dedicada a drinks e produto. O bloco laranja sobe a partir da parte inferior e funciona como base gráfica da headline, mas o drink, o copo, a borda, o rótulo e as mãos devem permanecer intocados. O CTA contornado aparece abaixo ou próximo da headline, sem competir com a leitura do produto.

O template só deve ser selecionado quando a fotografia possui produto claramente identificável e uma transição inferior que suporte a cor. O sistema deve proteger rótulos e formas do drink e reprovar qualquer alteração semântica ou deformação do produto.

| Campo          | Especificação                                                                 |
| -------------- | ----------------------------------------------------------------------------- |
| Âncora         | `LOWER_CENTER`                                                                |
| Ordem          | apoio opcional → headline → CTA → footer                                      |
| Área segura    | transição laranja inferior e campo acima do produto                           |
| Área protegida | drink, rótulo, borda do copo, mãos e marca                                    |
| Cor            | headline branca sobre laranja; texto escuro em strips brancos                 |
| Footer         | quatro logos brancos sobre o campo laranja ou escurecimento local             |
| Reprovar se    | produto for redesenhado, deformado, coberto ou deslocado sem pedido explícito |

### 5.10 `SUNSET_REF_10_INFO_TOP_LOGO`

A referência `IMG_6170.png` é funcional e usa a Toca como assinatura superior. O título “PÔR DO SOL” é sans forte e pode ocupar um painel ou faixa de contraste; o horário aparece como informação secundária de alta legibilidade. Como a assinatura Toca já está no topo, o footer pode ser reduzido para Corona, Red Bull e Morro Digital.

Esse template não deve receber headline editorial longa. A finalidade é informar e orientar. O tratamento laranja é local e deve se combinar com a fotografia, podendo receber um pequeno acento azul/cinza quando a referência pedir separação funcional.

| Campo          | Especificação                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Âncora         | `TOP_RIGHT_TO_CENTER`                                                                                 |
| Ordem          | logo Toca → título funcional → horário → apoio/CTA → footer reduzido                                  |
| Área segura    | canto superior para logo; centro para mensagem; faixa inferior para horário                           |
| Área protegida | sujeito hero, rosto, produto e horizonte                                                              |
| Cor            | branco em painel escuro/laranja; preto em área clara                                                  |
| Footer         | três logos, pois a Toca já assina no topo                                                             |
| Reprovar se    | o título funcional for tratado como headline serif longa ou o footer duplicar a assinatura sem motivo |

### 5.11 `SUNSET_REF_11_INFO_ORANGE_BLUE`

A referência `IMG_2216.png` é a variação funcional com laranja dominante e acento azul/cinza. O laranja organiza a mensagem principal e o azul/cinza serve como painel secundário de contraste; nenhum dos dois deve ser aplicado como filtro global. A assinatura Toca pode estar no topo, permitindo footer reduzido.

Esse template é adequado para chamadas de horário, produto Sunset ou informação de campanha em que a cor precisa separar a mensagem da fotografia. A headline funcional usa sans semibold; a serif Bodoni/Didot só entra em uma linha secundária aspiracional, se houver espaço e necessidade.

| Campo          | Especificação                                                                      |
| -------------- | ---------------------------------------------------------------------------------- |
| Âncora         | `TOP_RIGHT_TO_LOWER_CENTER`                                                        |
| Ordem          | assinatura Toca → título funcional → horário → apoio/CTA → footer                  |
| Área segura    | painel laranja, painel azul/cinza e campo inferior livre                           |
| Área protegida | sujeito, rosto, produto e fonte de luz                                             |
| Cor            | branco em laranja/azul escuro; preto em campo claro                                |
| Footer         | três logos com assinatura Toca superior ou quatro sem ela                          |
| Reprovar se    | azul/cinza virar filtro global, a mensagem perder dominância ou a foto for apagada |

## 6. Schema mínimo para o sistema

A biblioteca machine-actionable acompanha este relatório em `toca_story_reference_template_library_v1.json`. Cada peça futura deve ser validada contra o schema abaixo.

| Campo                   | Tipo   | Obrigatoriedade | Descrição                                         |
| ----------------------- | ------ | --------------: | ------------------------------------------------- |
| `reference_template_id` | string |     obrigatória | Identificador do template de referência           |
| `reference_file`        | string |     obrigatória | Nome do benchmark visual                          |
| `template_family`       | enum   |     obrigatória | Família de composição                             |
| `headline_font_role`    | enum   |     obrigatória | Serif editorial ou sans funcional                 |
| `sans_font_role`        | enum   |     obrigatória | Regular, Medium ou Semibold                       |
| `layout_anchor`         | enum   |     obrigatória | Região de composição escolhida                    |
| `safe_regions`          | array  |     obrigatória | Caixas livres analisadas individualmente          |
| `protected_regions`     | array  |     obrigatória | Elementos que não podem ser cobertos              |
| `headline_color`        | enum   |     obrigatória | `BLACK` ou `WHITE`, por luminância local          |
| `badge_color`           | enum   |   quando houver | Cor do selo/horário por luminância local          |
| `support_mode`          | enum   |     obrigatória | `NONE`, `WHITE_STRIPS` ou `WHITE_TRANSLUCENT_BOX` |
| `footer_mode`           | enum   |     obrigatória | Quatro logos ou três com Toca no topo             |
| `overlap_check`         | enum   |     obrigatória | `PASS` somente sem interseção                     |
| `contrast_check`        | enum   |     obrigatória | `PASS` somente com leitura suficiente             |

## 7. Quality Gate e seleção futura

O sistema deve primeiro classificar a fotografia: `LANDSCAPE`, `SILHOUETTE`, `LIFESTYLE`, `DRINK_PRODUCT`, `FUNCTIONAL_INFO` ou `LIGHT_NEGATIVE_FIELD`. Em seguida, deve identificar as regiões protegidas e as áreas de respiro. Só então deve selecionar um dos onze templates, podendo usar uma família equivalente, mas nunca um layout genérico sem `reference_template_id`.

Uma peça deve ser reprovada quando o headline cobrir qualquer elemento essencial, quando a cor for escolhida pela imagem inteira em vez da área local, quando houver texto branco sobre fundo claro sem suporte, quando o apoio for convertido em caixa preta genérica, quando o CTA não tiver contorno ou quando os logos não forem os arquivos oficiais. Também deve ser reprovada quando o template escolhido não corresponder ao objetivo da fotografia, mesmo que o texto esteja legível.

A revisão humana mínima deve comparar uma peça contra a referência que originou seu template. Para um lote com mais de uma família, deve haver ao menos uma revisão por família. A aprovação não deve ocorrer apenas pela presença de `STORY_READY`; o campo correto após a comparação é `PASSED_REFERENCE_REVIEW`.

## 8. Status da implementação

O catálogo humano e o arquivo machine-actionable foram criados como **biblioteca de templates**. A primeira peça de teste não deve ser considerada aprovada nem publicada. O próximo passo recomendado é selecionar uma referência específica para cada asset, realizar a análise individual de `safe_regions` e `protected_regions`, compor uma única peça e submetê-la à validação humana antes de replicar o template.

### Arquivos relacionados

- [Reference Lock — Sunset v1.3](https://docs.google.com/document/d/1qdoHESuJiyAhGB7jOViodhfPBKszYJWxCYeFP-4Pajs/edit)
- Biblioteca machine-actionable: `toca_story_reference_template_library_v1.json`
- Manifesto de zonas seguras já iniciado: `toca_story_safe_zones.json`
