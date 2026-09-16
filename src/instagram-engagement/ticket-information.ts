import type { InstagramEngagementKnowledgeMatch } from './knowledge.js';

export const TOCA_OFFICIAL_INFORMATION_URL = 'https://linktr.ee/tocadomorcegooficial';

export const TOCA_TICKET_INFORMATION_REPLY = `Os valores dos ingressos variam de acordo com a data. Para consultar a programação, próximos eventos, valores, comprar ingressos, cardápio, atendimento via WhatsApp e mais informações, acesse: ${TOCA_OFFICIAL_INFORMATION_URL}`;

export function enforceOfficialTicketInformation(
  match: InstagramEngagementKnowledgeMatch,
): InstagramEngagementKnowledgeMatch {
  if (match.intent !== 'TICKET_INFO') return match;
  return {
    ...match,
    answer: TOCA_TICKET_INFORMATION_REPLY,
  };
}
