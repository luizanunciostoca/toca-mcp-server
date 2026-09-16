import type { InstagramEngagementKnowledgeMatch } from './knowledge.js';

export const TOCA_OFFICIAL_INFORMATION_URL =
  'https://linktr.ee/tocadomorcegooficial?utm_source=ig&utm_medium=social&utm_content=link_in_bio&fbclid=PAdGRleAUXIVtwZG9mAmZkaWQWUOjnvXodfGyf-tm4_9E7SiXgNZTUeGV4dG4DYWVtAjExAHNydGMGYXBwX2lkDzEyNDAyNDU3NDI4NzQxNAABp086VQy0Dat5n1xOChyOLdqrAGTe_PQjh0WEXTPGeHtbPP2jPX0YsVAp7cyd_aem_dKq3n3m9OlgJ6Y_Y1BKxxQ';

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
