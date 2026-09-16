import { createHash } from 'node:crypto';
import type { CrmSalesStore } from '../crm/sales-engine.js';
import { MetaApiError } from '../providers/meta/meta-api-client.js';
import type { InstagramEngagementProvider } from '../providers/instagram/instagram-engagement-contracts.js';
import {
  contentKeyForPlaybook,
  PostgresInstagramSalesFunnelStore,
  type ClaimedInstagramSalesFunnelAction,
} from './postgres-sales-funnel-store.js';
import { salesFunnelMessage } from './sales-funnel.js';

const INSTAGRAM_SAFE_WINDOW_MS = 23 * 60 * 60 * 1000;

export interface InstagramSalesFunnelDispatcherOptions {
  readonly store: PostgresInstagramSalesFunnelStore;
  readonly sales: CrmSalesStore;
  readonly provider: InstagramEngagementProvider;
  readonly pageId: string;
  readonly instagramUserId: string;
  readonly writesEnabled: boolean;
  readonly actorPrincipalId?: string;
}

export interface InstagramSalesFunnelDispatchResult {
  readonly claimed: number;
  readonly sent: number;
  readonly canceled: number;
  readonly ambiguous: number;
}

export class InstagramSalesFunnelDispatcher {
  readonly #actorPrincipalId: string;

  constructor(private readonly options: InstagramSalesFunnelDispatcherOptions) {
    if (!options.pageId.trim()) throw new Error('INSTAGRAM_SALES_FUNNEL_PAGE_ID_REQUIRED');
    if (!options.instagramUserId.trim()) {
      throw new Error('INSTAGRAM_SALES_FUNNEL_BUSINESS_ACCOUNT_ID_REQUIRED');
    }
    this.#actorPrincipalId =
      options.actorPrincipalId?.trim() || 'system:instagram-sales-funnel-dispatcher';
  }

  async runDue(nowInput: Date = new Date(), limit = 5): Promise<InstagramSalesFunnelDispatchResult> {
    if (!this.options.writesEnabled) {
      return { claimed: 0, sent: 0, canceled: 0, ambiguous: 0 };
    }
    const now = nowInput.toISOString();
    const actions = await this.options.store.claimDue({ now, limit });
    let sent = 0;
    let canceled = 0;
    let ambiguous = 0;

    for (const action of actions) {
      const outcome = await this.dispatchOne(action, now);
      if (outcome === 'SENT') sent += 1;
      else if (outcome === 'AMBIGUOUS') ambiguous += 1;
      else canceled += 1;
    }
    return { claimed: actions.length, sent, canceled, ambiguous };
  }

  private async dispatchOne(
    action: ClaimedInstagramSalesFunnelAction,
    now: string,
  ): Promise<'SENT' | 'CANCELED' | 'AMBIGUOUS'> {
    const proof = await this.options.store.resolveRecipientAndWindow(action);
    if (!proof) {
      await this.cancel(action, now, 'RECIPIENT_OR_INBOUND_PROOF_MISSING');
      return 'CANCELED';
    }

    const nowMs = Date.parse(now);
    const inboundMs = Date.parse(proof.latestInboundAt);
    const dueMs = Date.parse(action.dueAt);
    const ageMs = nowMs - inboundMs;
    if (ageMs < 0 || ageMs > INSTAGRAM_SAFE_WINDOW_MS) {
      await this.cancel(action, now, 'INSTAGRAM_USER_WINDOW_CLOSED');
      return 'CANCELED';
    }
    if (inboundMs > dueMs) {
      await this.cancel(action, now, 'USER_REENGAGED_AFTER_ACTION_SCHEDULED');
      return 'CANCELED';
    }

    const contentKey = contentKeyForPlaybook(action.playbookKey);
    const message = salesFunnelMessage(contentKey);
    try {
      const result = await this.options.provider.sendDirectReply({
        pageId: this.options.pageId,
        instagramUserId: this.options.instagramUserId,
        recipientScopedId: proof.recipientScopedId,
        message,
      });
      if (!result.messageId?.trim()) {
        await this.cancel(action, now, 'INSTAGRAM_FOLLOWUP_PROVIDER_ACK_MISSING');
        return 'AMBIGUOUS';
      }
      await this.options.store.completeSent({
        action,
        providerMessageId: result.messageId,
        now,
      });
      await this.recordActivity(action, now, 'SENT', result.messageId);
      return 'SENT';
    } catch (error) {
      const code = safeErrorCode(error);
      await this.options.store.cancel({ action, now, reason: `SEND_OUTCOME_${code}` });
      await this.recordActivity(
        action,
        now,
        isAmbiguousProviderFailure(error) ? 'AMBIGUOUS' : 'FAILED',
      );
      return isAmbiguousProviderFailure(error) ? 'AMBIGUOUS' : 'CANCELED';
    }
  }

  private async cancel(
    action: ClaimedInstagramSalesFunnelAction,
    now: string,
    reason: string,
  ): Promise<void> {
    await this.options.store.cancel({ action, now, reason });
    await this.recordActivity(action, now, `CANCELED:${reason}`);
  }

  private async recordActivity(
    action: ClaimedInstagramSalesFunnelAction,
    now: string,
    outcome: string,
    providerMessageId?: string,
  ): Promise<void> {
    const activityId = deterministicId('igf-activity', action.nextActionId, outcome);
    try {
      await this.options.sales.appendActivity({
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        organizationId: action.organizationId,
        activityId,
        contactId: action.contactId,
        leadId: action.leadId,
        activityType: action.actionType === 'POST_SALE' ? 'POST_SALE' : 'FOLLOW_UP',
        channel: 'INSTAGRAM',
        summary: `Instagram sales funnel ${action.playbookKey}`,
        outcome,
        idempotencyKey: `instagram-sales-funnel-activity:${activityId}`,
        executionId: `instagram-sales-funnel:${action.nextActionId}`,
        correlationId: `instagram-sales-funnel:${action.leadId}`,
        actorPrincipalId: this.#actorPrincipalId,
        evidence: [
          `instagram:sales-funnel:next-action:${action.nextActionId}`,
          `instagram:sales-funnel:playbook:${action.playbookKey}`,
          ...(providerMessageId
            ? [`instagram:sales-funnel:provider-message:${providerMessageId}`]
            : []),
        ],
        occurredAt: now,
        now,
      });
    } catch (error) {
      console.error(
        'Instagram sales funnel activity recording failed',
        JSON.stringify({
          nextActionId: action.nextActionId,
          errorCode: safeErrorCode(error),
        }),
      );
    }
  }
}

function isAmbiguousProviderFailure(error: unknown): boolean {
  if (error instanceof MetaApiError) return true;
  if (!(error instanceof Error)) return true;
  return error.message.startsWith('INSTAGRAM_INVALID_RESPONSE:');
}

function safeErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const first = raw.split('|', 1)[0]?.split(':', 1)[0]?.trim() || 'UNKNOWN';
  return /^[A-Z0-9_]+$/.test(first) ? first.slice(0, 120) : 'UNKNOWN';
}

function deterministicId(prefix: string, ...material: readonly string[]): string {
  const digest = createHash('sha256').update(material.join(':')).digest('hex').slice(0, 32);
  return `${prefix}_${digest}`;
}
