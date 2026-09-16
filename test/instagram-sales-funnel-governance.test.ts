import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runtime = readFileSync('src/instagram-engagement/runtime.ts', 'utf8');
const dispatcher = readFileSync('src/instagram-engagement/sales-funnel-dispatcher.ts', 'utf8');
const reconciler = readFileSync('src/instagram-engagement/post-sale-reconciler.ts', 'utf8');
const planner = readFileSync('src/instagram-engagement/sales-funnel.ts', 'utf8');

describe('Instagram sales funnel governance boundaries', () => {
  it('keeps planning and external follow-up writes behind separate switches', () => {
    expect(runtime).toContain('INSTAGRAM_SALES_FUNNEL_ENABLED');
    expect(runtime).toContain('INSTAGRAM_SALES_FUNNEL_WRITES_ENABLED');
    expect(runtime).toContain('config.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED &&');
  });

  it('never uses HUMAN_AGENT to extend automated promotional messaging', () => {
    expect(runtime).not.toContain('HUMAN_AGENT');
    expect(dispatcher).not.toContain('HUMAN_AGENT');
    expect(planner).not.toContain('HUMAN_AGENT');
  });

  it('uses a conservative 23-hour execution window and terminal ambiguous outcomes', () => {
    expect(dispatcher).toContain('23 * 60 * 60 * 1000');
    expect(dispatcher).toContain('INSTAGRAM_USER_WINDOW_CLOSED');
    expect(dispatcher).toContain("status = 'CANCELED'").toBe(false);
    expect(dispatcher).not.toContain('requeue');
  });

  it('reconciles post-sale only from CRM opportunities that are already WON', () => {
    expect(reconciler).toContain("where o.status = 'WON'");
    expect(reconciler).toContain('crm:won:revenue-gate-enforced');
    expect(reconciler).not.toContain('click');
    expect(reconciler).not.toContain('utm');
  });

  it('gates the Saturday samba/pagode cross-sell separately', () => {
    expect(runtime).toContain('INSTAGRAM_SALES_FUNNEL_SATURDAY_SAMBA_PAGODE_VERIFIED');
    expect(planner).toContain('saturdaySambaPagodeVerified === true');
  });
});
