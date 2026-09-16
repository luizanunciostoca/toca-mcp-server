import type { InstagramEngagementKnowledgeSnapshotRow } from './knowledge-snapshot-expanded-core.js';
import {
  INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID as CORE_SPREADSHEET_ID,
  INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE as EXPANDED_CORE_KNOWLEDGE,
} from './knowledge-snapshot-expanded-core.js';

export type { InstagramEngagementKnowledgeSnapshotRow } from './knowledge-snapshot-expanded-core.js';

export const INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID = CORE_SPREADSHEET_ID;

const OFFICIAL_TICKET_LINKTREE =
  'https://linktr.ee/tocadomorcegooficial?utm_source=ig&utm_medium=social&utm_content=link_in_bio&fbclid=PAdGRleAUXIVtwZG9mAmZkaWQWUOjnvXodfGyf-tm4_9E7SiXgNZTUeGV4dG4DYWVtAjExAHNydGMGYXBwX2lkDzEyNDAyNDU3NDI4NzQxNAABp086VQy0Dat5n1xOChyOLdqrAGTe_PQjh0WEXTPGeHtbPP2jPX0YsVAp7cyd_aem_dKq3n3m9OlgJ6Y_Y1BKxxQ';

const OFFICIAL_TICKET_ANSWER =
  `Os valores dos ingressos variam de acordo com a data. Para consultar a programação, próximos eventos, valores, comprar ingressos, cardápio, atendimento via WhatsApp e mais informações, acesse: ${OFFICIAL_TICKET_LINKTREE}`;

const SOURCE_DATES: readonly { readonly marker: string; readonly updatedOn: string }[] = [
  { marker: '1Sr4jKNvWZQSlAr3g7klkw_Eou3yLESrcOv2Ednjk7g4', updatedOn: '2026-08-28' },
  { marker: '1Die7TmOHK8sP6uyZQM4S_hVfe81aoNAhpmBWulCAld4', updatedOn: '2026-09-02' },
  { marker: '1PKLkxUGVOUOT4yLWiMr6O0eNfmtQiymQWITs_-_h6fo', updatedOn: '2026-08-08' },
  { marker: '1Fgf5vfVD-aHlq1B_8oGTEASEFHv4oQvrtwL2bnMptlY', updatedOn: '2026-08-08' },
  { marker: '1eZQpT1RDtfKnLAH3WksI0tFLigFL9HWZnsGz_Jki6l0', updatedOn: '2026-08-29' },
  { marker: '1KfnV3QJ-skOSs4elA1QQGVr98PSTr8R4', updatedOn: '2026-08-28' },
  { marker: '1dRBuf8z9hgxwoaBSMAHrbhjxqu3bTJZ1iV_OB6DNYMo', updatedOn: '2026-08-28' },
];

const TICKET_VARIANTS = new Map<string, readonly string[]>([
  [
    'FAQ-003',
    [
      'Qual o valor do Sunset?',
      'Quanto é a entrada?',
      'Quanto custa The Party?',
      'Preço do ingresso?',
      'Qual o valor da festa?',
      'Quanto pago para entrar?',
      'Valor da entrada hoje?',
      'Quanto custa o ingresso hoje?',
      'Qual o valor do ingresso?',
    ],
  ],
  [
    'FAQ-004',
    [
      'Como comprar ingresso?',
      'Onde compro entrada?',
      'Tem link de ingresso?',
      'Onde vejo os ingressos?',
      'Como garantir meu ingresso?',
      'Onde compra ingresso da Toca?',
      'Qual o link dos ingressos?',
      'Quero comprar ingresso?',
      'Quero comprar ingressos?',
      'Quero ingresso?',
      'Quero garantir meu ingresso?',
      'Onde comprar ingresso?',
    ],
  ],
]);

const RECONCILED_CORE = EXPANDED_CORE_KNOWLEDGE.map((row) => reconcileCoreRow(row));

const FAQ_036: InstagramEngagementKnowledgeSnapshotRow = {
  faqId: 'FAQ-036',
  canonicalQuestion: 'O que tem no Sunset de sábado?',
  variants: [
    'Sábado tem o quê na Toca?',
    'Tem samba sábado?',
    'Tem pagode sábado?',
    'O Sunset de sábado tem samba?',
    'O Sunset de sábado tem pagode?',
    'Qual a programação de sábado?',
  ],
  intent: 'EVENT_INFO',
  risk: 'LOW',
  autonomy: 'AUTO_REPLY_ALLOWED',
  answer:
    'Aos sábados, o Sunset da Toca tem samba e pagode. Para conferir a programação vigente, próximos eventos, valores e ingressos, consulte o link oficial da Toca.',
  source: 'Direção Toca — atualização operacional 2026-09-16',
  factsToValidate:
    'Se houver edição especial ou alteração oficialmente comunicada para a data, a programação vigente prevalece.',
  sourceUpdatedOn: '2026-09-16',
  status: 'APROVADO',
  operationalValidity: 'ATIVO_ATE_SUBSTITUICAO_CANONICA',
};

export const INSTAGRAM_ENGAGEMENT_CURRENT_KNOWLEDGE: readonly InstagramEngagementKnowledgeSnapshotRow[] =
  [...RECONCILED_CORE, FAQ_036];

function reconcileCoreRow(
  row: InstagramEngagementKnowledgeSnapshotRow,
): InstagramEngagementKnowledgeSnapshotRow {
  const sourceUpdatedOn = sourceUpdatedOnFor(row.source, row.sourceUpdatedOn);
  const ticketVariants = TICKET_VARIANTS.get(row.faqId);
  if (row.faqId === 'FAQ-003' || row.faqId === 'FAQ-004') {
    return {
      ...row,
      variants: ticketVariants ?? row.variants,
      answer: OFFICIAL_TICKET_ANSWER,
      sourceUpdatedOn,
    };
  }
  return { ...row, sourceUpdatedOn };
}

function sourceUpdatedOnFor(source: string, fallback: string): string {
  const matchedDates = SOURCE_DATES.filter(({ marker }) => source.includes(marker)).map(
    ({ updatedOn }) => updatedOn,
  );
  if (matchedDates.length === 0) return fallback;
  return matchedDates.sort().at(-1) ?? fallback;
}
