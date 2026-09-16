import { describe, expect, it, vi } from 'vitest';
import type { CrmSalesStore } from '../src/crm/sales-engine.js';
import type { InstagramEngagementProvider } from '../src/providers/instagram/instagram-engagement-contracts.js';
import {
  PostgresInstagramSalesFunnelStore,
  type ClaimedInstagramSalesFunnelAction,
} from '../src/instagram-engagement/postgres-sales-funnel-store.js';
import { InstagramSalesFunnelDispatcher } from '../src/instagram-engagement/sales-funnel-dispatcher.js';

const ACTION: ClaimedInstagramSalesFunnelAction = {
  nextActionId: 'next-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
  contactId: 'contact-1',
  leadId: 'lead-1',
  actionType: 'FOLLOW_UP',
  playbookKey: 'instagram-ticket-follow-up-help-v1',
  dueAt: '2026-09-16T12:00:00.000Z',
  createdAt: '2026-09-16T10:00:00.000Z',
  version: 2,
};

function harness(input: {
  readonly writesEnabled?: boolean;
  readonly latestInboundAt?: string;
  readonly providerError?: Error;
}) {
  const claimDue = vi.fn().mockResolvedValue([ACTION]);
  const resolveRecipientAndWindow = vi.fn().mockResolvedValue({
    recipientScopedId: 'recipient-1',
    latestInboundAt: input.latestInboundAt ?? '2026-09-16T10:00:00.000Z',
  });
  const completeSent = vi.fn().mockResolvedValue(undefined);
  const cancel = vi.fn().mockResolvedValue(undefined);
  const store = {
    claimDue,
    resolveRecipientAndWindow,
    completeSent,
    cancel,
  } as unknown as PostgresInstagramSalesFunnelStore;

  const appendActivity = vi.fn().mockResolvedValue({});
  const sales = { appendActivity } as unknown as CrmSalesStore;
  const sendDirectReply = input.providerError
    ? vi.fn().mockRejectedValue(input.providerError)
    : vi.fn().mockResolvedValue({ recipientId: 'recipient-1', messageId: 'provider-message-1' });
  const provider = {
    replyToComment: vi.fn(),
    sendDirectReply,
  } as unknown as InstagramEngagementProvider;
  const dispatcher = new InstagramSalesFunnelDispatcher({
    store,
    sales,
    provider,
    pageId: 'page-1',
    instagramUserId: 'ig-business-1',
    writesEnabled: input.writesEnabled ?? true,
  });
  return {
    dispatcher,
    claimDue,
    resolveRecipientAndWindow,
    completeSent,
    cancel,
    appendActivity,
    sendDirectReply,
  };
}

describe('Instagram sales funnel dispatcher', () => {
  it('does not even claim due actions when the separate funnel write switch is off', async () => {
    const test = harness({ writesEnabled: false });
    const result = await test.dispatcher.runDue(new Date('2026-09-16T12:00:00.000Z'), 1);

    expect(result).toEqual({ claimed: 0, sent: 0, canceled: 0, ambiguous: 0 });
    expect(test.claimDue).not.toHaveBeenCalled();
    expect(test.sendDirectReply).not.toHaveBeenCalled();
  });

  it('sends one due follow-up only with a fresh user-initiated window and provider ACK', async () => {
    const test = harness({});
    const result = await test.dispatcher.runDue(new Date('2026-09-16T12:00:00.000Z'), 1);

    expect(result).toEqual({ claimed: 1, sent: 1, canceled: 0, ambiguous: 0 });
    expect(test.sendDirectReply).toHaveBeenCalledOnce();
    expect(test.completeSent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: ACTION,
        providerMessageId: 'provider-message-1',
      }),
    );
    expect(test.cancel).not.toHaveBeenCalled();
    expect(test.appendActivity).toHaveBeenCalledOnce();
  });

  it('cancels a stale scheduled follow-up if the user re-engaged after it was created', async () => {
    const test = harness({ latestInboundAt: '2026-09-16T11:00:00.000Z' });
    const result = await test.dispatcher.runDue(new Date('2026-09-16T12:00:00.000Z'), 1);

    expect(result.canceled).toBe(1);
    expect(test.sendDirectReply).not.toHaveBeenCalled();
    expect(test.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'USER_REENGAGED_AFTER_ACTION_SCHEDULED' }),
    );
  });

  it('cancels rather than sends outside the conservative 23-hour execution window', async () => {
    const test = harness({ latestInboundAt: '2026-09-15T12:30:00.000Z' });
    const result = await test.dispatcher.runDue(new Date('2026-09-16T12:00:00.000Z'), 1);

    expect(result.canceled).toBe(1);
    expect(test.sendDirectReply).not.toHaveBeenCalled();
    expect(test.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'INSTAGRAM_USER_WINDOW_CLOSED' }),
    );
  });

  it('treats an uncertain provider result as terminal and never requeues it', async () => {
    const test = harness({ providerError: new Error('INSTAGRAM_INVALID_RESPONSE:missing id') });
    const result = await test.dispatcher.runDue(new Date('2026-09-16T12:00:00.000Z'), 1);

    expect(result).toEqual({ claimed: 1, sent: 0, canceled: 0, ambiguous: 1 });
    expect(test.sendDirectReply).toHaveBeenCalledOnce();
    expect(test.completeSent).not.toHaveBeenCalled();
    expect(test.cancel).toHaveBeenCalledOnce();
    expect(test.claimDue).toHaveBeenCalledOnce();
  });
});
