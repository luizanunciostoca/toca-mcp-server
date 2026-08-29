import type { EngagementIntent } from '../policy/engagement-policy.js';

export const INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID =
  '1529TovmZFt1oBkCQ_K7kjRdjGuRidkfgPEJuzY4YvuA';

export interface InstagramEngagementKnowledgeSnapshotRow {
  readonly faqId: string;
  readonly canonicalQuestion: string;
  readonly variants: readonly string[];
  readonly intent: EngagementIntent;
  readonly risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly autonomy: 'READ_ONLY' | 'SUGGEST_ONLY' | 'AUTO_REPLY_ALLOWED' | 'HUMAN_REVIEW_REQUIRED';
  readonly answer: string;
  readonly source: string;
  readonly factsToValidate: string;
  readonly sourceUpdatedOn: string;
  readonly status: string;
  readonly operationalValidity: string;
}

export const INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE: readonly InstagramEngagementKnowledgeSnapshotRow[] =
  [
    {
      faqId: 'FAQ-001',
      canonicalQuestion: 'Que horas começa o Sunset?',
      variants: [
        'Qual o horário do Sunset?',
        'Que horas abre o Sunset?',
        'O Sunset abre que horas?',
        'Sunset começa quando?',
        'O Sunset funciona todos os dias?',
      ],
      intent: 'LOCATION_HOURS',
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      answer:
        'O Sunset acontece todos os dias, a partir das 16:30, no horário da Bahia. O horário de encerramento pode variar conforme a operação do dia e não deve ser presumido.',
      source:
        'TOCA_OS — 08_OPERACOES — HOMOLOGACAO_E_PARAMETROS_OPERACIONAIS_v1.1 — Drive ID 1Sr4jKNvWZQSlAr3g7klkw_Eou3yLESrcOv2Ednjk7g4 — DEC-02',
      factsToValidate:
        'Se a pergunta for sobre horário de encerramento ou evento especial, validar a operação/evento vigente.',
      sourceUpdatedOn: '2026-08-28',
      status: 'APROVADO',
      operationalValidity: 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
    },
    {
      faqId: 'FAQ-002',
      canonicalQuestion: 'Que dia e que horas acontece a The Party?',
      variants: [
        'Qual o horário da The Party?',
        'The Party é que dia?',
        'Que horas começa a festa de sexta?',
        'A festa termina que horas?',
        'Tem The Party sexta?',
      ],
      intent: 'LOCATION_HOURS',
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      answer:
        'A The Party acontece às sextas-feiras, das 23:59 às 06:00, atravessando a madrugada de sábado, no horário da Bahia.',
      source:
        'TOCA_OS — 08_OPERACOES — HOMOLOGACAO_E_PARAMETROS_OPERACIONAIS_v1.1 — Drive ID 1Sr4jKNvWZQSlAr3g7klkw_Eou3yLESrcOv2Ednjk7g4 — DEC-02',
      factsToValidate:
        'Se houver evento especial ou alteração excepcional, validar EVENTOS_READINESS vigente.',
      sourceUpdatedOn: '2026-08-28',
      status: 'APROVADO',
      operationalValidity: 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
    },
    {
      faqId: 'FAQ-003',
      canonicalQuestion: 'Quanto custa o ingresso?',
      variants: [
        'Qual o valor do Sunset?',
        'Quanto é a entrada?',
        'Quanto custa The Party?',
        'Preço do ingresso?',
        'Qual o valor da festa?',
      ],
      intent: 'TICKET_INFO',
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      answer:
        'Os valores dos ingressos podem variar e não ficam fixados nesta base. Para ver o preço vigente, consulte o site oficial da Toca do Morcego ou o link disponível na bio do Instagram @tocadomorcego.',
      source:
        'TOCA_OS — 08_OPERACOES — HOMOLOGACAO_E_PARAMETROS_OPERACIONAIS_v1.1 — Drive ID 1Sr4jKNvWZQSlAr3g7klkw_Eou3yLESrcOv2Ednjk7g4 — DEC-02',
      factsToValidate:
        'Nunca inventar nem reutilizar preço antigo; direcionar para canal oficial vigente.',
      sourceUpdatedOn: '2026-08-28',
      status: 'APROVADO',
      operationalValidity: 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
    },
    {
      faqId: 'FAQ-004',
      canonicalQuestion: 'Onde compro ingressos?',
      variants: [
        'Como comprar ingresso?',
        'Onde compro entrada?',
        'Tem link de ingresso?',
        'Onde vejo os ingressos?',
        'Como garantir meu ingresso?',
      ],
      intent: 'TICKET_INFO',
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      answer:
        'Os ingressos e valores vigentes devem ser consultados no site oficial www.tocadomorcego.com.br ou pelo link disponível na bio do Instagram @tocadomorcego.',
      source:
        'TOCA_OS — 08_OPERACOES — HOMOLOGACAO_E_PARAMETROS_OPERACIONAIS_v1.1 — Drive ID 1Sr4jKNvWZQSlAr3g7klkw_Eou3yLESrcOv2Ednjk7g4 — DEC-02',
      factsToValidate: 'Confirmar apenas canais oficiais; não fornecer links de terceiros.',
      sourceUpdatedOn: '2026-08-28',
      status: 'APROVADO',
      operationalValidity: 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
    },
    {
      faqId: 'FAQ-005',
      canonicalQuestion: 'Qual é o site oficial da Toca?',
      variants: [
        'Tem site?',
        'Qual o site da Toca?',
        'Onde vejo informações oficiais?',
        'Site oficial?',
      ],
      intent: 'FAQ_OPERATIONAL',
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      answer: 'O site oficial é www.tocadomorcego.com.br.',
      source:
        'TOCA_OS — 08_OPERACOES — HOMOLOGACAO_E_PARAMETROS_OPERACIONAIS_v1.1 — Drive ID 1Sr4jKNvWZQSlAr3g7klkw_Eou3yLESrcOv2Ednjk7g4 — DEC-02',
      factsToValidate: 'Nenhum adicional.',
      sourceUpdatedOn: '2026-08-28',
      status: 'APROVADO',
      operationalValidity: 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
    },
    {
      faqId: 'FAQ-006',
      canonicalQuestion: 'Qual é o Instagram oficial?',
      variants: [
        'Qual o insta da Toca?',
        'Instagram da Toca?',
        'Qual perfil oficial?',
        'Qual o @ da Toca?',
      ],
      intent: 'GENERAL_SOCIAL',
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      answer: 'O Instagram oficial é @tocadomorcego.',
      source:
        'TOCA_OS — 08_OPERACOES — HOMOLOGACAO_E_PARAMETROS_OPERACIONAIS_v1.1 — Drive ID 1Sr4jKNvWZQSlAr3g7klkw_Eou3yLESrcOv2Ednjk7g4 — DEC-02',
      factsToValidate: 'Nenhum adicional.',
      sourceUpdatedOn: '2026-08-28',
      status: 'APROVADO',
      operationalValidity: 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
    },
    {
      faqId: 'FAQ-007',
      canonicalQuestion: 'Qual é o WhatsApp de atendimento?',
      variants: [
        'Tem WhatsApp?',
        'Qual o número da Toca?',
        'Como falo com atendimento?',
        'Contato da Toca?',
      ],
      intent: 'FAQ_OPERATIONAL',
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      answer: 'O WhatsApp oficial de atendimento informado pela direção é +55 75 99179-5418.',
      source:
        'TOCA_OS — 08_OPERACOES — HOMOLOGACAO_E_PARAMETROS_OPERACIONAIS_v1.1 — Drive ID 1Sr4jKNvWZQSlAr3g7klkw_Eou3yLESrcOv2Ednjk7g4 — DEC-02; evidência 06_RECEPCAO Drive ID 1pYUPyoxyPoIWxPkmQhWzUhNi8MqIkmqP',
      factsToValidate:
        'Se houver atualização posterior do contato oficial, a fonte mais recente prevalece.',
      sourceUpdatedOn: '2026-08-28',
      status: 'APROVADO',
      operationalValidity: 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
    },
    {
      faqId: 'FAQ-008',
      canonicalQuestion: 'Onde fica a Toca do Morcego?',
      variants: [
        'Onde é a Toca?',
        'Qual a localização da Toca?',
        'A Toca fica onde?',
        'Em que lugar fica a Toca do Morcego?',
      ],
      intent: 'LOCATION_HOURS',
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      answer:
        'A Toca do Morcego fica em Morro de São Paulo, na Ilha de Tinharé, Bahia. Para a rota exata até a entrada, use o endereço disponível nos canais oficiais da Toca.',
      source:
        'Base de Conhecimento — Toca do Morcego — Drive ID 12V7lA5o6Tvdxa68DtLa_L4ZNTcPZYgsC; TOCA OS posicionamento/identidade vigente',
      factsToValidate:
        'Não inventar referência de praia, distância ou rota sem fonte atual específica.',
      sourceUpdatedOn: '2026-08-28',
      status: 'APROVADO',
      operationalValidity: 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
    },
    {
      faqId: 'FAQ-009',
      canonicalQuestion: 'Onde vejo o cardápio e os preços atuais?',
      variants: [
        'Tem cardápio?',
        'Quanto custam os drinks?',
        'Quais os preços do bar?',
        'Onde vejo o menu?',
        'Cardápio atualizado?',
      ],
      intent: 'FAQ_OPERATIONAL',
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      answer:
        'A Toca mantém um cardápio vigente e os valores podem ser atualizados. Para preço de item específico, consulte o cardápio oficial vigente ou confirme com o atendimento; a IA não deve reutilizar valores de versões antigas.',
      source:
        'TOCA_OS — 08_OPERACOES — HOMOLOGACAO_E_PARAMETROS_OPERACIONAIS_v1.1 — DEC-08; CARDAPIO_OFICIAL_VIGENTE_Toca_do_Morcego_2026_vAtual_2026-08-28.pdf — Drive ID 1KfnV3QJ-skOSs4elA1QQGVr98PSTr8R4',
      factsToValidate:
        'Para citar valor exato, consultar a versão visual canônica vigente no momento do atendimento.',
      sourceUpdatedOn: '2026-08-28',
      status: 'APROVADO',
      operationalValidity: 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
    },
    {
      faqId: 'FAQ-010',
      canonicalQuestion: 'Quero fazer uma reserva ou evento privado, como faço?',
      variants: [
        'Tem camarote?',
        'Quero comemorar aniversário',
        'Quero fechar evento',
        'Quero parceria',
        'Quero patrocinar',
        'Quero reservar mesa',
      ],
      intent: 'COMMERCIAL_LEAD',
      risk: 'MEDIUM',
      autonomy: 'SUGGEST_ONLY',
      answer:
        'Tratar como oportunidade comercial e encaminhar para atendimento humano/CRM; não confirmar disponibilidade, condição comercial, benefício ou preço sem validação.',
      source:
        'TOCA OS — engagement policy / CRM social canônico; política oficial de atendimento por IA no Instagram',
      factsToValidate: 'Coletar apenas os dados mínimos necessários e encaminhar ao responsável.',
      sourceUpdatedOn: '2026-08-28',
      status: 'APROVADO',
      operationalValidity: 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
    },
  ];
