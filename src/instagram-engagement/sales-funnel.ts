export const INSTAGRAM_SALES_FUNNEL_VERSION = '1.0.0';

export const TOCA_OFFICIAL_LINKTREE =
  'https://linktr.ee/tocadomorcegooficial?utm_source=ig&utm_medium=social&utm_content=link_in_bio&fbclid=PAdGRleAUXIVtwZG9mAmZkaWQWUOjnvXodfGyf-tm4_9E7SiXgNZTUeGV4dG4DYWVtAjExAHNydGMGYXBwX2lkDzEyNDAyNDU3NDI4NzQxNAABp086VQy0Dat5n1xOChyOLdqrAGTe_PQjh0WEXTPGeHtbPP2jPX0YsVAp7cyd_aem_dKq3n3m9OlgJ6Y_Y1BKxxQ';

const INSTAGRAM_WINDOW_MS = 24 * 60 * 60 * 1000;
const INSTAGRAM_WINDOW_BUFFER_MS = 60 * 60 * 1000;
const FOLLOW_UP_ONE_DELAY_MS = 2 * 60 * 60 * 1000;
const FOLLOW_UP_TWO_DELAY_MS = 20 * 60 * 60 * 1000;

export type InstagramSalesProduct = 'SUNSET' | 'THE_PARTY' | 'BOTH' | 'UNSPECIFIED';
export type InstagramSalesJourneyStage =
  | 'DISCOVERY'
  | 'CONSIDERATION'
  | 'PURCHASE_INTENT'
  | 'PURCHASED'
  | 'NURTURE'
  | 'HUMAN_HANDOFF';
export type InstagramSalesFunnelChannel = 'INSTAGRAM' | 'WHATSAPP' | 'EMAIL' | 'NONE';
export type InstagramSalesFunnelActionType =
  | 'FOLLOW_UP'
  | 'REACTIVATE'
  | 'POST_SALE'
  | 'CROSS_SELL'
  | 'WAIT_FOR_REENGAGEMENT'
  | 'HUMAN_HANDOFF';
export type InstagramSalesFunnelContentKey =
  | 'TICKET_FOLLOW_UP_HELP'
  | 'TICKET_FOLLOW_UP_LAST_WINDOW'
  | 'SUNSET_POST_SALE'
  | 'SUNSET_SATURDAY_SAMBA_PAGODE'
  | 'THE_PARTY_POST_SALE'
  | 'UPCOMING_EVENTS_CROSS_SELL';

export interface InstagramSalesFunnelPlanInput {
  readonly leadId: string;
  readonly contactId: string;
  readonly lastInboundAt: string;
  readonly now: string;
  readonly product: InstagramSalesProduct;
  readonly journeyStage: InstagramSalesJourneyStage;
  readonly commercialIntent: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  readonly noResponseCount?: number;
  readonly explicitOptOut?: boolean;
  readonly humanRequired?: boolean;
  readonly factsVerified?: boolean;
  readonly saturdaySambaPagodeVerified?: boolean;
  readonly whatsappConsented?: boolean;
  readonly whatsappProductionValidated?: boolean;
  readonly emailConsented?: boolean;
  readonly emailProductionValidated?: boolean;
}

export interface InstagramSalesFunnelAction {
  readonly actionType: InstagramSalesFunnelActionType;
  readonly channel: InstagramSalesFunnelChannel;
  readonly contentKey: InstagramSalesFunnelContentKey | null;
  readonly playbookKey: string;
  readonly dueAt: string | null;
  readonly priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  readonly rationale: string;
  readonly sendEligible: boolean;
}

export interface InstagramSalesFunnelPlan {
  readonly version: string;
  readonly windowClosesAt: string;
  readonly instagramWindowOpen: boolean;
  readonly actions: readonly InstagramSalesFunnelAction[];
}

export function planInstagramSalesFunnel(
  input: InstagramSalesFunnelPlanInput,
): InstagramSalesFunnelPlan {
  requireText(input.leadId, 'INSTAGRAM_SALES_FUNNEL_LEAD_ID_REQUIRED');
  requireText(input.contactId, 'INSTAGRAM_SALES_FUNNEL_CONTACT_ID_REQUIRED');
  const lastInboundMs = timestampMs(input.lastInboundAt, 'INSTAGRAM_SALES_FUNNEL_LAST_INBOUND_INVALID');
  const nowMs = timestampMs(input.now, 'INSTAGRAM_SALES_FUNNEL_NOW_INVALID');
  const windowClosesMs = lastInboundMs + INSTAGRAM_WINDOW_MS;
  const windowClosesAt = new Date(windowClosesMs).toISOString();
  const instagramWindowOpen = nowMs >= lastInboundMs && nowMs < windowClosesMs;

  if (input.explicitOptOut) {
    return { version: INSTAGRAM_SALES_FUNNEL_VERSION, windowClosesAt, instagramWindowOpen, actions: [] };
  }

  if (input.humanRequired || input.journeyStage === 'HUMAN_HANDOFF') {
    return {
      version: INSTAGRAM_SALES_FUNNEL_VERSION,
      windowClosesAt,
      instagramWindowOpen,
      actions: [
        {
          actionType: 'HUMAN_HANDOFF',
          channel: 'NONE',
          contentKey: null,
          playbookKey: 'instagram-sales-human-handoff-v1',
          dueAt: input.now,
          priority: 'URGENT',
          rationale: 'Human-required conversations never enter automated sales nurture.',
          sendEligible: false,
        },
      ],
    };
  }

  const actions: InstagramSalesFunnelAction[] = [];
  const alternateChannel = eligibleAlternateChannel(input);
  const factsVerified = input.factsVerified === true;
  const noResponseCount = input.noResponseCount ?? 0;

  if (input.journeyStage === 'PURCHASED') {
    if (input.product === 'SUNSET' || input.product === 'BOTH') {
      actions.push(
        buildChannelAwareAction({
          input,
          nowMs,
          windowClosesMs,
          alternateChannel,
          actionType: 'POST_SALE',
          contentKey: 'SUNSET_POST_SALE',
          playbookKey: 'instagram-post-sale-sunset-v1',
          dueMs: Math.max(nowMs, lastInboundMs + FOLLOW_UP_ONE_DELAY_MS),
          priority: 'MEDIUM',
          rationale: 'A confirmed Sunset purchase enters the post-sale relationship flow.',
          factsVerified,
        }),
      );
      if (input.saturdaySambaPagodeVerified === true) {
        actions.push(
          buildChannelAwareAction({
            input,
            nowMs,
            windowClosesMs,
            alternateChannel,
            actionType: 'CROSS_SELL',
            contentKey: 'SUNSET_SATURDAY_SAMBA_PAGODE',
            playbookKey: 'instagram-cross-sell-saturday-samba-pagode-v1',
            dueMs: Math.max(nowMs, lastInboundMs + 3 * 60 * 60 * 1000),
            priority: 'MEDIUM',
            rationale:
              'Verified Saturday samba/pagode programming may be offered after a Sunset purchase.',
            factsVerified,
          }),
        );
      }
    }
    if (input.product === 'THE_PARTY' || input.product === 'BOTH') {
      actions.push(
        buildChannelAwareAction({
          input,
          nowMs,
          windowClosesMs,
          alternateChannel,
          actionType: 'POST_SALE',
          contentKey: 'THE_PARTY_POST_SALE',
          playbookKey: 'instagram-post-sale-the-party-v1',
          dueMs: Math.max(nowMs, lastInboundMs + FOLLOW_UP_ONE_DELAY_MS),
          priority: 'MEDIUM',
          rationale: 'A confirmed The Party purchase enters the post-sale relationship flow.',
          factsVerified,
        }),
      );
    }
    actions.push(
      buildChannelAwareAction({
        input,
        nowMs,
        windowClosesMs,
        alternateChannel,
        actionType: 'CROSS_SELL',
        contentKey: 'UPCOMING_EVENTS_CROSS_SELL',
        playbookKey: 'instagram-cross-sell-upcoming-events-v1',
        dueMs: Math.max(nowMs, lastInboundMs + 4 * 60 * 60 * 1000),
        priority: 'LOW',
        rationale: 'Won customers remain eligible for verified upcoming-event cross-sell.',
        factsVerified,
      }),
    );
    return {
      version: INSTAGRAM_SALES_FUNNEL_VERSION,
      windowClosesAt,
      instagramWindowOpen,
      actions,
    };
  }

  const purchaseLike =
    input.journeyStage === 'PURCHASE_INTENT' ||
    input.commercialIntent === 'HIGH' ||
    input.commercialIntent === 'MEDIUM';

  if (purchaseLike && factsVerified) {
    const firstDueMs = lastInboundMs + FOLLOW_UP_ONE_DELAY_MS;
    if (noResponseCount < 1) {
      actions.push(
        buildChannelAwareAction({
          input,
          nowMs,
          windowClosesMs,
          alternateChannel,
          actionType: 'FOLLOW_UP',
          contentKey: 'TICKET_FOLLOW_UP_HELP',
          playbookKey: 'instagram-ticket-follow-up-help-v1',
          dueMs: firstDueMs,
          priority: 'HIGH',
          rationale:
            'A purchase-intent lead receives one relevant help check-in while the user-initiated window remains open.',
          factsVerified,
        }),
      );
    }

    const secondDueMs = lastInboundMs + FOLLOW_UP_TWO_DELAY_MS;
    if (noResponseCount < 2) {
      actions.push(
        buildChannelAwareAction({
          input,
          nowMs,
          windowClosesMs,
          alternateChannel,
          actionType: 'FOLLOW_UP',
          contentKey: 'TICKET_FOLLOW_UP_LAST_WINDOW',
          playbookKey: 'instagram-ticket-follow-up-last-window-v1',
          dueMs: secondDueMs,
          priority: 'MEDIUM',
          rationale:
            'A second and final in-window check-in is allowed before automated Instagram outreach stops.',
          factsVerified,
        }),
      );
    }
  }

  if (!instagramWindowOpen || noResponseCount >= 2) {
    actions.push({
      actionType: alternateChannel === 'NONE' ? 'WAIT_FOR_REENGAGEMENT' : 'REACTIVATE',
      channel: alternateChannel,
      contentKey: alternateChannel === 'NONE' ? null : 'UPCOMING_EVENTS_CROSS_SELL',
      playbookKey:
        alternateChannel === 'NONE'
          ? 'instagram-wait-for-user-reengagement-v1'
          : 'consented-omnichannel-reactivation-v1',
      dueAt: alternateChannel === 'NONE' ? null : input.now,
      priority: 'LOW',
      rationale:
        alternateChannel === 'NONE'
          ? 'Instagram automation must stop outside the user-initiated messaging window until the user re-engages.'
          : 'The lead may continue only on a separately consented and production-validated channel.',
      sendEligible: alternateChannel !== 'NONE' && factsVerified,
    });
  }

  return {
    version: INSTAGRAM_SALES_FUNNEL_VERSION,
    windowClosesAt,
    instagramWindowOpen,
    actions,
  };
}

export function salesFunnelMessage(contentKey: InstagramSalesFunnelContentKey): string {
  switch (contentKey) {
    case 'TICKET_FOLLOW_UP_HELP':
      return `Conseguiu acessar a programação e os ingressos? Se ainda tiver alguma dúvida ou precisar de ajuda para escolher o melhor dia, estou por aqui. Os valores dos ingressos variam de acordo com a data. Para programação, próximos eventos, valores, compra de ingressos, cardápio, atendimento via WhatsApp e mais informações: ${TOCA_OFFICIAL_LINKTREE}`;
    case 'TICKET_FOLLOW_UP_LAST_WINDOW':
      return `Passando para confirmar se você conseguiu resolver 😊 Se ainda quiser vir à Toca, posso ajudar com suas dúvidas. Os valores dos ingressos variam conforme a data, e a programação, os próximos eventos, valores, ingressos, cardápio e WhatsApp estão aqui: ${TOCA_OFFICIAL_LINKTREE}`;
    case 'SUNSET_POST_SALE':
      return `Que bom ter você com a gente no Sunset! Depois da sua experiência, vale acompanhar os próximos eventos e novidades da Toca. Programação, ingressos, cardápio e atendimento: ${TOCA_OFFICIAL_LINKTREE}`;
    case 'SUNSET_SATURDAY_SAMBA_PAGODE':
      return `E tem mais: aos sábados, quando a programação vigente estiver confirmada, o Sunset da Toca recebe samba e pagode. Confira a programação atual, próximos eventos e ingressos aqui: ${TOCA_OFFICIAL_LINKTREE}`;
    case 'THE_PARTY_POST_SALE':
      return `Ingresso garantido para a The Party 🙌 Aproveite também para conhecer o Sunset e acompanhar os próximos eventos da Toca. Programação, ingressos, cardápio e atendimento: ${TOCA_OFFICIAL_LINKTREE}`;
    case 'UPCOMING_EVENTS_CROSS_SELL':
      return `Quer viver a próxima experiência da Toca também? Confira a programação atualizada, próximos eventos, valores, ingressos, cardápio e atendimento via WhatsApp: ${TOCA_OFFICIAL_LINKTREE}`;
  }
}

function buildChannelAwareAction(input: {
  readonly input: InstagramSalesFunnelPlanInput;
  readonly nowMs: number;
  readonly windowClosesMs: number;
  readonly alternateChannel: InstagramSalesFunnelChannel;
  readonly actionType: InstagramSalesFunnelActionType;
  readonly contentKey: InstagramSalesFunnelContentKey;
  readonly playbookKey: string;
  readonly dueMs: number;
  readonly priority: InstagramSalesFunnelAction['priority'];
  readonly rationale: string;
  readonly factsVerified: boolean;
}): InstagramSalesFunnelAction {
  const safeInstagramDeadlineMs = input.windowClosesMs - INSTAGRAM_WINDOW_BUFFER_MS;
  if (input.dueMs <= safeInstagramDeadlineMs) {
    return {
      actionType: input.actionType,
      channel: 'INSTAGRAM',
      contentKey: input.contentKey,
      playbookKey: input.playbookKey,
      dueAt: new Date(Math.max(input.nowMs, input.dueMs)).toISOString(),
      priority: input.priority,
      rationale: input.rationale,
      sendEligible: input.factsVerified,
    };
  }
  if (input.alternateChannel !== 'NONE') {
    return {
      actionType: input.actionType,
      channel: input.alternateChannel,
      contentKey: input.contentKey,
      playbookKey: input.playbookKey,
      dueAt: new Date(Math.max(input.nowMs, input.dueMs)).toISOString(),
      priority: input.priority,
      rationale: `${input.rationale} Instagram window unavailable; use only the consented validated channel.`,
      sendEligible: input.factsVerified,
    };
  }
  return {
    actionType: 'WAIT_FOR_REENGAGEMENT',
    channel: 'NONE',
    contentKey: null,
    playbookKey: 'instagram-wait-for-user-reengagement-v1',
    dueAt: null,
    priority: 'LOW',
    rationale:
      'The planned follow-up falls outside the safe Instagram window and no alternate consented production channel is available.',
    sendEligible: false,
  };
}

function eligibleAlternateChannel(
  input: InstagramSalesFunnelPlanInput,
): InstagramSalesFunnelChannel {
  if (input.whatsappConsented && input.whatsappProductionValidated) return 'WHATSAPP';
  if (input.emailConsented && input.emailProductionValidated) return 'EMAIL';
  return 'NONE';
}

function timestampMs(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

function requireText(value: string, code: string): void {
  if (!value.trim()) throw new Error(code);
}
