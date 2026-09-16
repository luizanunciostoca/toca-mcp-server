import { describe, expect, it } from 'vitest';
import {
  planInstagramSalesFunnel,
  salesFunnelMessage,
  TOCA_OFFICIAL_LINKTREE,
  type InstagramSalesFunnelPlanInput,
} from '../src/instagram-engagement/sales-funnel.js';

const LAST_INBOUND = '2026-09-16T10:00:00.000Z';

function input(
  overrides: Partial<InstagramSalesFunnelPlanInput> = {},
): InstagramSalesFunnelPlanInput {
  return {
    leadId: 'lead-1',
    contactId: 'contact-1',
    lastInboundAt: LAST_INBOUND,
    now: LAST_INBOUND,
    product: 'THE_PARTY',
    journeyStage: 'PURCHASE_INTENT',
    commercialIntent: 'HIGH',
    factsVerified: true,
    ...overrides,
  };
}

describe('Instagram governed sales funnel', () => {
  it('plans at most two in-window purchase follow-ups', () => {
    const plan = planInstagramSalesFunnel(input());

    expect(plan.instagramWindowOpen).toBe(true);
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions.map((action) => action.playbookKey)).toEqual([
      'instagram-ticket-follow-up-help-v1',
      'instagram-ticket-follow-up-last-window-v1',
    ]);
    expect(plan.actions.every((action) => action.channel === 'INSTAGRAM')).toBe(true);
    expect(plan.actions.every((action) => action.sendEligible)).toBe(true);
    expect(plan.actions.map((action) => action.dueAt)).toEqual([
      '2026-09-16T12:00:00.000Z',
      '2026-09-17T06:00:00.000Z',
    ]);
  });

  it('stops all nurture after an explicit opt-out', () => {
    const plan = planInstagramSalesFunnel(input({ explicitOptOut: true }));
    expect(plan.actions).toEqual([]);
  });

  it('never schedules an Instagram send when execution planning occurs after the safe window', () => {
    const plan = planInstagramSalesFunnel(
      input({ now: '2026-09-17T11:00:00.000Z', noResponseCount: 0 }),
    );
    expect(plan.instagramWindowOpen).toBe(false);
    expect(plan.actions.some((action) => action.channel === 'INSTAGRAM' && action.sendEligible)).toBe(
      false,
    );
    expect(plan.actions.some((action) => action.actionType === 'WAIT_FOR_REENGAGEMENT')).toBe(true);
  });

  it('uses an alternate channel only when both consent and production validation exist', () => {
    const plan = planInstagramSalesFunnel(
      input({
        now: '2026-09-17T11:00:00.000Z',
        whatsappConsented: true,
        whatsappProductionValidated: true,
      }),
    );
    expect(plan.actions.some((action) => action.channel === 'WHATSAPP' && action.sendEligible)).toBe(
      true,
    );
  });

  it('gates Saturday samba/pagode cross-sell on a verified current fact', () => {
    const withoutVerification = planInstagramSalesFunnel(
      input({
        product: 'SUNSET',
        journeyStage: 'PURCHASED',
        commercialIntent: 'NONE',
        saturdaySambaPagodeVerified: false,
      }),
    );
    const verified = planInstagramSalesFunnel(
      input({
        product: 'SUNSET',
        journeyStage: 'PURCHASED',
        commercialIntent: 'NONE',
        saturdaySambaPagodeVerified: true,
      }),
    );

    expect(
      withoutVerification.actions.some(
        (action) => action.contentKey === 'SUNSET_SATURDAY_SAMBA_PAGODE',
      ),
    ).toBe(false);
    expect(
      verified.actions.some((action) => action.contentKey === 'SUNSET_SATURDAY_SAMBA_PAGODE'),
    ).toBe(true);
    expect(verified.actions.some((action) => action.actionType === 'POST_SALE')).toBe(true);
    expect(verified.actions.some((action) => action.actionType === 'CROSS_SELL')).toBe(true);
  });

  it('keeps the official ticket Linktree and variable-price rule in sales messages', () => {
    for (const key of ['TICKET_FOLLOW_UP_HELP', 'TICKET_FOLLOW_UP_LAST_WINDOW'] as const) {
      const message = salesFunnelMessage(key);
      expect(message).toContain(TOCA_OFFICIAL_LINKTREE);
      expect(message.toLowerCase()).toContain('valores');
      expect(message.toLowerCase()).toContain('data');
    }
  });
});
