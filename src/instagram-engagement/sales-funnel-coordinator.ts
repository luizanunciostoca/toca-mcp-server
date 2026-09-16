import { createHash } from 'node:crypto';
import type { CrmScope } from '../crm/crm-records.js';
import type { CrmSalesStore, NextActionType } from '../crm/sales-engine.js';
import {
  planInstagramSalesFunnel,
  type InstagramSalesFunnelAction,
  type InstagramSalesFunnelPlan,
  type InstagramSalesFunnelPlanInput,
} from './sales-funnel.js';

export interface InstagramSalesFunnelCoordinatorOptions {
  readonly sales: CrmSalesStore;
  readonly actorPrincipalId?: string;
}

export interface InstagramSalesFunnelCoordinateInput
  extends CrmScope,
    InstagramSalesFunnelPlanInput {
  readonly executionId: string;
  readonly correlationId: string;
  readonly evidence: readonly string[];
}

export class InstagramSalesFunnelCoordinator {
  readonly #actorPrincipalId: string;

  constructor(private readonly options: InstagramSalesFunnelCoordinatorOptions) {
    this.#actorPrincipalId =
      options.actorPrincipalId?.trim() || 'system:instagram-sales-funnel';
  }

  async coordinate(
    input: InstagramSalesFunnelCoordinateInput,
  ): Promise<InstagramSalesFunnelPlan> {
    const plan = planInstagramSalesFunnel(input);
    for (const action of plan.actions) {
      if (!shouldPersistAction(action)) continue;
      const nextActionId = deterministicNextActionId(input.leadId, action);
      await this.options.sales.scheduleNextAction({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        nextActionId,
        contactId: input.contactId,
        leadId: input.leadId,
        actionType: crmActionType(action),
        title: titleForAction(action),
        rationale: action.rationale,
        priority: action.priority,
        playbookKey: action.playbookKey,
        dueAt: action.dueAt,
        idempotencyKey: `instagram-sales-funnel:${nextActionId}`,
        executionId: input.executionId,
        correlationId: input.correlationId,
        actorPrincipalId: this.#actorPrincipalId,
        evidence: [
          ...new Set([
            ...input.evidence,
            'instagram:sales-funnel:planned',
            `instagram:sales-funnel:channel:${action.channel.toLowerCase()}`,
            `instagram:sales-funnel:playbook:${action.playbookKey}`,
          ]),
        ],
        now: input.now,
      });
    }
    return plan;
  }
}

function shouldPersistAction(action: InstagramSalesFunnelAction): boolean {
  return action.actionType === 'HUMAN_HANDOFF' || action.sendEligible;
}

function crmActionType(action: InstagramSalesFunnelAction): NextActionType {
  switch (action.actionType) {
    case 'HUMAN_HANDOFF':
      return 'HUMAN_HANDOFF';
    case 'POST_SALE':
      return 'POST_SALE';
    case 'REACTIVATE':
      return 'REACTIVATE';
    case 'CROSS_SELL':
    case 'FOLLOW_UP':
      return 'FOLLOW_UP';
    case 'WAIT_FOR_REENGAGEMENT':
      return 'REACTIVATE';
  }
}

function titleForAction(action: InstagramSalesFunnelAction): string {
  switch (action.actionType) {
    case 'HUMAN_HANDOFF':
      return 'Instagram lead — human handoff';
    case 'POST_SALE':
      return 'Instagram customer — post-sale follow-up';
    case 'CROSS_SELL':
      return 'Instagram customer — next experience cross-sell';
    case 'REACTIVATE':
      return 'Sales lead — consented reactivation';
    case 'FOLLOW_UP':
      return 'Instagram sales lead — follow-up';
    case 'WAIT_FOR_REENGAGEMENT':
      return 'Instagram lead — wait for re-engagement';
  }
}

function deterministicNextActionId(
  leadId: string,
  action: InstagramSalesFunnelAction,
): string {
  const material = [
    leadId,
    action.actionType,
    action.channel,
    action.playbookKey,
    action.dueAt ?? 'none',
  ].join(':');
  const digest = createHash('sha256').update(material).digest('hex').slice(0, 32);
  return `igf_${digest}`;
}
