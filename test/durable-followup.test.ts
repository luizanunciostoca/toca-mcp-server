import { describe, expect, it } from 'vitest';
import {
  createTrustedServiceExecutionIdentity,
  type ExecutionIdentity,
} from '../src/core/identity.js';
import type { CrmScope } from '../src/crm/crm-records.js';
import type {
  CrmSalesStore,
  NextActionRecord,
  SalesActivityRecord,
} from '../src/crm/sales-engine.js';
import type { ApprovalRecord } from '../src/governance/approval-governance.js';
import type { CoreCapabilityGateway } from '../src/orchestrator/contracts.js';
import {
  DurableFollowupCoordinator,
  durableFollowupWorkflowId,
  type DurableFollowupChannel,
  type DurableFollowupScheduleInput,
} from '../src/orchestrator/durable-followup.js';
import { InMemoryWorkflowStore } from '../src/workflow/in-memory-workflow-store.js';
import type { WorkflowInstance } from '../src/workflow/workflow-contracts.js';
import type { DeadLetterRecord, DeadLetterSink } from '../src/worker/worker.js';

const SCOPE: CrmScope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  organizationId: 'org-a',
};
const DUE_AT = '2026-08-21T06:00:00.000Z';
const BEFORE_DUE = '2026-08-21T05:00:00.000Z';
const CORRELATION_ID = 'corr-followup-1';
const APPROVAL_ID = 'approval-followup-1';

class FakeSalesStore {
  readonly actions = new Map<string, NextActionRecord>();
  readonly activities: Array<Parameters<CrmSalesStore['appendActivity']>[0]> = [];

  put(action: NextActionRecord): void {
    this.actions.set(actionKey(action, action.nextActionId), action);
  }

  setStatus(scope: CrmScope, nextActionId: string, status: NextActionRecord['status']): void {
    const key = actionKey(scope, nextActionId);
    const action = this.actions.get(key);
    if (!action) throw new Error('TEST_NEXT_ACTION_NOT_FOUND');
    this.actions.set(key, { ...action, status, updatedAt: DUE_AT, version: action.version + 1 });
  }

  getNextAction(
    input: CrmScope & { readonly nextActionId: string },
  ): Promise<NextActionRecord | undefined> {
    return Promise.resolve(this.actions.get(actionKey(input, input.nextActionId)));
  }

  appendActivity(
    input: Parameters<CrmSalesStore['appendActivity']>[0],
  ): Promise<SalesActivityRecord> {
    this.activities.push(input);
    return Promise.resolve({} as SalesActivityRecord);
  }

  asStore(): CrmSalesStore {
    return this as unknown as CrmSalesStore;
  }
}

class FakeDeadLetters implements DeadLetterSink {
  readonly records: DeadLetterRecord[] = [];

  put(record: DeadLetterRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
}

class FakeCore implements CoreCapabilityGateway {
  readonly executions: Array<Parameters<CoreCapabilityGateway['execute']>[0]> = [];
  readonly providerCalls: string[] = [];
  failuresRemaining = 0;
  privacyBlockCode: string | null = null;

  inspect(input: Parameters<CoreCapabilityGateway['inspect']>[0]) {
    return {
      canonicalCapabilityId: input.capabilityId,
      routeId: input.capabilityId === 'email.campaign.send' ? ('R07' as const) : ('R10' as const),
      sideEffects: true,
      approvalRequired: true,
      idempotent: true,
    };
  }

  async execute(input: Parameters<CoreCapabilityGateway['execute']>[0]) {
    this.executions.push(input);
    if (this.privacyBlockCode) throw new Error(this.privacyBlockCode);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('PROVIDER_TEMPORARILY_UNAVAILABLE');
    }
    this.providerCalls.push(input.capabilityId);
    const index = this.executions.length;
    return {
      executionId: `provider-exec-${index}`,
      capabilityId: input.capabilityId,
      result:
        input.capabilityId === 'email.campaign.send'
          ? {
              provider_dispatch_id: `email-provider-${index}`,
              provider: 'SENDGRID',
              state: 'ACCEPTED',
              accepted_at: DUE_AT,
            }
          : {
              provider_message_id: `wa-provider-${index}`,
              provider: 'META_WHATSAPP_CLOUD',
              state: 'ACCEPTED',
              accepted_at: DUE_AT,
            },
      providerReadbackVerified: true,
    };
  }

  requestApproval(): Promise<ApprovalRecord> {
    return Promise.reject(new Error('TEST_APPROVAL_REQUEST_NOT_EXPECTED'));
  }

  getApproval(): Promise<ApprovalRecord | undefined> {
    return Promise.resolve(undefined);
  }
}

class FailFirstTimerArmWorkflowStore extends InMemoryWorkflowStore {
  failTimerArm = true;

  override scheduleTimer(
    input: Parameters<InMemoryWorkflowStore['scheduleTimer']>[0],
  ): ReturnType<InMemoryWorkflowStore['scheduleTimer']> {
    if (this.failTimerArm) {
      this.failTimerArm = false;
      return Promise.reject(new Error('TEST_PROCESS_RESTART_DURING_TIMER_ARM'));
    }
    return super.scheduleTimer(input);
  }
}

function actionKey(scope: CrmScope, nextActionId: string): string {
  return `${scope.tenantId}|${scope.workspaceId}|${scope.organizationId}|${nextActionId}`;
}

function createIdentity(scope: CrmScope = SCOPE): ExecutionIdentity {
  return createTrustedServiceExecutionIdentity({
    principalId: 'ag01-service',
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    organizationId: scope.organizationId,
    roles: ['ADMIN'],
    allowedRouteIds: null,
    allowedCapabilityIds: null,
    allowedTargetAccounts: null,
    evidence: ['test:durable-followup'],
    now: BEFORE_DUE,
  });
}

function createNextAction(
  scope: CrmScope = SCOPE,
  nextActionId = 'next-action-1',
): NextActionRecord {
  return {
    ...scope,
    nextActionId,
    contactId: 'contact-1',
    leadId: 'lead-1',
    opportunityId: null,
    actionType: 'FOLLOW_UP',
    title: 'Follow up lead',
    rationale: 'Continue the commercial conversation.',
    priority: 'HIGH',
    status: 'PENDING',
    ownerPrincipalId: 'ag01-service',
    playbookKey: 'follow-up-v1',
    dueAt: DUE_AT,
    completedAt: null,
    version: 1,
    createdAt: BEFORE_DUE,
    updatedAt: BEFORE_DUE,
  };
}

function outboundPayload(channel: DurableFollowupChannel, scope: CrmScope = SCOPE) {
  const common = {
    tenant_id: scope.tenantId,
    workspace_id: scope.workspaceId,
    organization_id: scope.organizationId,
    correlation_id: CORRELATION_ID,
    approval_id: APPROVAL_ID,
    approval_status: 'APPROVED',
    message_id: `message-${channel.toLowerCase()}`,
    idempotency_key: `followup-send-${channel.toLowerCase()}`,
  };
  if (channel === 'EMAIL') {
    return {
      ...common,
      audience_snapshot_id: 'audience-1',
      privacy_purpose_id: 'marketing-followup',
      resolved_contact_count: 1,
      ambiguous_contact_count: 0,
      unresolved_contact_count: 0,
      privacy_unknown_blocked_count: 0,
      privacy_suppressed_count: 0,
      policy_denied_count: 0,
      prepared_campaign_id: 'prepared-email-1',
    };
  }
  return {
    ...common,
    contact_record_id: 'contact-1',
    contact_resolution_id: 'contact-resolution-1',
    contact_resolution_status: 'RESOLVED',
    privacy_execution_id: 'privacy-exec-1',
    privacy_subject_ref: 'privacy-subject-1',
    privacy_state: 'ALLOWED',
    privacy_blocked: false,
    privacy_purpose_id: 'marketing-followup',
    privacy_channel: 'WHATSAPP',
    policy_decision_id: 'policy-1',
    policy_allowed: true,
    prepared_message_id: 'prepared-wa-1',
  };
}

function scheduleInput(
  channel: DurableFollowupChannel,
  identity = createIdentity(),
  scope: CrmScope = SCOPE,
): DurableFollowupScheduleInput {
  return {
    ...scope,
    nextActionId: 'next-action-1',
    channel,
    outboundPayload: outboundPayload(channel, scope),
    approvalId: APPROVAL_ID,
    correlationId: CORRELATION_ID,
    identity,
    evidence: ['test:next-action-created-by:sales.followup.schedule'],
    now: BEFORE_DUE,
  };
}

function fixture(options: { readonly workflows?: InMemoryWorkflowStore } = {}) {
  const workflows = options.workflows ?? new InMemoryWorkflowStore();
  const sales = new FakeSalesStore();
  const core = new FakeCore();
  const deadLetters = new FakeDeadLetters();
  const identity = createIdentity();
  sales.put(createNextAction());
  const createCoordinator = () =>
    new DurableFollowupCoordinator({
      workflows,
      sales: sales.asStore(),
      core,
      deadLetters,
      resolveIdentity: (_instance: WorkflowInstance) => identity,
      retry: { baseDelayMs: 1_000, maxDelayMs: 4_000 },
    });
  return { workflows, sales, core, deadLetters, identity, createCoordinator };
}

describe('durable follow-up final composition', () => {
  it('schedule -> restart -> resume executes the correct Email channel with correlation and CRM outcome', async () => {
    const test = fixture();
    const firstRuntime = test.createCoordinator();
    const scheduled = await firstRuntime.schedule(scheduleInput('EMAIL', test.identity));

    expect(scheduled.steps[0]?.status).toBe('WAITING_TIMER');
    expect(scheduled.timers).toHaveLength(1);
    expect(scheduled.timers[0]?.status).toBe('SCHEDULED');

    const restartedRuntime = test.createCoordinator();
    await restartedRuntime.tick(10, DUE_AT);

    expect(test.core.executions).toHaveLength(1);
    expect(test.core.executions[0]?.capabilityId).toBe('email.campaign.send');
    expect(test.core.executions[0]?.correlationId).toBe(CORRELATION_ID);
    expect(test.core.executions[0]?.approvalId).toBe(APPROVAL_ID);
    expect(test.sales.activities).toHaveLength(1);
    expect(test.sales.activities[0]?.outcome).toBe('SENT');
    expect(test.sales.activities[0]?.correlationId).toBe(CORRELATION_ID);

    const final = await test.workflows.get(scheduled.instance.workflowId);
    expect(final?.instance.status).toBe('SUCCEEDED');
  });

  it('duplicate timer fire is idempotent and does not duplicate provider execution', async () => {
    const test = fixture();
    const runtime = test.createCoordinator();
    await runtime.schedule(scheduleInput('WHATSAPP', test.identity));

    const first = await runtime.tick(10, DUE_AT);
    const second = await runtime.tick(10, DUE_AT);

    expect(first.processedWorkflowIds).toHaveLength(1);
    expect(second.processedWorkflowIds).toHaveLength(0);
    expect(test.core.executions).toHaveLength(1);
    expect(test.core.executions[0]?.capabilityId).toBe('whatsapp.message.send');
    expect(test.sales.activities).toHaveLength(1);
  });

  it.each([
    ['consent revoked before due_at', 'EMAIL' as const, 'CONSENT_REVOKED'],
    ['unsubscribe before due_at', 'EMAIL' as const, 'EMAIL_UNSUBSCRIBED'],
    ['WhatsApp suppressed before due_at', 'WHATSAPP' as const, 'WHATSAPP_SUPPRESSED'],
  ])(
    '%s is blocked by fresh send-time privacy without provider send',
    async (_name, channel, code) => {
      const test = fixture();
      const runtime = test.createCoordinator();
      await runtime.schedule(scheduleInput(channel, test.identity));

      test.core.privacyBlockCode = code;
      await runtime.tick(10, DUE_AT);

      expect(test.core.executions).toHaveLength(1);
      expect(test.core.providerCalls).toHaveLength(0);
      expect(test.deadLetters.records).toHaveLength(0);
      expect(test.sales.activities).toHaveLength(1);
      expect(test.sales.activities[0]?.outcome).toBe(`BLOCKED:${code}`);
    },
  );

  it('provider temporarily unavailable retries through Workflow timer and recovers after runtime restart', async () => {
    const test = fixture();
    const runtime = test.createCoordinator();
    test.core.failuresRemaining = 1;
    const scheduled = await runtime.schedule({
      ...scheduleInput('WHATSAPP', test.identity),
      maxAttempts: 3,
    });

    await runtime.tick(10, DUE_AT);
    const retryWaiting = await test.workflows.get(scheduled.instance.workflowId);
    expect(retryWaiting?.steps[0]?.status).toBe('WAITING_TIMER');
    expect(retryWaiting?.steps[0]?.attempts).toBe(2);
    expect(test.deadLetters.records).toHaveLength(0);

    const restartedRuntime = test.createCoordinator();
    await restartedRuntime.tick(10, '2026-08-21T06:00:01.000Z');

    expect(test.core.executions).toHaveLength(2);
    expect(test.core.providerCalls).toEqual(['whatsapp.message.send']);
    expect(test.sales.activities.at(-1)?.outcome).toBe('SENT');
    const final = await test.workflows.get(scheduled.instance.workflowId);
    expect(final?.instance.status).toBe('SUCCEEDED');
  });

  it('retry exhaustion writes the existing DLQ and records the CRM SalesActivity outcome', async () => {
    const test = fixture();
    const runtime = test.createCoordinator();
    test.core.failuresRemaining = 10;
    const scheduled = await runtime.schedule({
      ...scheduleInput('EMAIL', test.identity),
      maxAttempts: 2,
    });

    await runtime.tick(10, DUE_AT);
    await runtime.tick(10, '2026-08-21T06:00:01.000Z');

    expect(test.core.executions).toHaveLength(2);
    expect(test.deadLetters.records).toHaveLength(1);
    expect(test.deadLetters.records[0]).toMatchObject({
      originalJobId: scheduled.instance.workflowId,
      toolName: 'email.campaign.send',
      attempts: 2,
      lastError: 'PROVIDER_TEMPORARILY_UNAVAILABLE',
    });
    expect(test.sales.activities.at(-1)?.outcome).toBe(
      'DEAD_LETTERED:PROVIDER_TEMPORARILY_UNAVAILABLE',
    );
  });

  it('cross-tenant next action cannot be scheduled or recovered', async () => {
    const test = fixture();
    const foreignScope: CrmScope = {
      tenantId: 'tenant-b',
      workspaceId: 'workspace-b',
      organizationId: 'org-b',
    };
    const foreignIdentity = createIdentity(foreignScope);

    await expect(
      test.createCoordinator().schedule(scheduleInput('EMAIL', foreignIdentity, foreignScope)),
    ).rejects.toThrow('DURABLE_FOLLOWUP_NEXT_ACTION_NOT_FOUND');
    expect(test.core.executions).toHaveLength(0);
  });

  it('repairs restart between Workflow claim and timer persistence without a duplicate workflow', async () => {
    const workflows = new FailFirstTimerArmWorkflowStore();
    const test = fixture({ workflows });
    const input = scheduleInput('EMAIL', test.identity);
    const workflowId = durableFollowupWorkflowId(SCOPE, input.nextActionId);

    await expect(test.createCoordinator().schedule(input)).rejects.toThrow(
      'TEST_PROCESS_RESTART_DURING_TIMER_ARM',
    );
    const stranded = await workflows.get(workflowId);
    expect(stranded?.steps[0]?.status).toBe('RUNNING');
    expect(stranded?.timers).toHaveLength(0);

    const recovered = await test.createCoordinator().schedule(input);
    expect(recovered.instance.workflowId).toBe(workflowId);
    expect(recovered.steps[0]?.status).toBe('WAITING_TIMER');
    expect(recovered.timers).toHaveLength(1);
  });

  it('schedule replay is idempotent and reuses the same workflow/timer', async () => {
    const test = fixture();
    const runtime = test.createCoordinator();
    const input = scheduleInput('WHATSAPP', test.identity);

    const first = await runtime.schedule(input);
    const replay = await runtime.schedule(input);

    expect(replay.instance.workflowId).toBe(first.instance.workflowId);
    expect(replay.timers).toHaveLength(1);
    expect(replay.timers[0]?.timerId).toBe(first.timers[0]?.timerId);
  });

  it('honors an existing NextAction cancellation at due time and never calls outbound', async () => {
    const test = fixture();
    const runtime = test.createCoordinator();
    await runtime.schedule(scheduleInput('WHATSAPP', test.identity));
    test.sales.setStatus(SCOPE, 'next-action-1', 'CANCELED');

    await runtime.tick(10, DUE_AT);

    expect(test.core.executions).toHaveLength(0);
    expect(test.sales.activities).toHaveLength(1);
    expect(test.sales.activities[0]?.outcome).toBe('CANCELED');
  });

  it('keeps non-follow-up Workflow timers owned by their original workers', async () => {
    const test = fixture();
    const runtime = test.createCoordinator();
    await test.workflows.create(
      {
        workflowId: 'other-workflow',
        routeId: 'R01',
        definitionId: 'other-definition',
        definitionVersion: '1',
        idempotencyKey: 'other-idempotency',
        correlationId: 'other-correlation',
        tenantId: SCOPE.tenantId,
        workspaceId: SCOPE.workspaceId,
        organizationId: SCOPE.organizationId,
        requesterPrincipalId: 'ag01-service',
        steps: [{ stepId: 'other-step', name: 'Other step', maxAttempts: 1 }],
      },
      BEFORE_DUE,
    );
    const claim = (
      await test.workflows.claimReadySteps({
        workerId: 'other-worker',
        now: BEFORE_DUE,
        limit: 1,
        workflowId: 'other-workflow',
      })
    )[0]!;
    await test.workflows.scheduleTimer({
      timerId: 'other-timer',
      workflowId: 'other-workflow',
      stepId: 'other-step',
      executionId: claim.executionId,
      fireAt: DUE_AT,
      evidence: ['test:other-timer'],
      now: BEFORE_DUE,
    });
    await runtime.schedule(scheduleInput('EMAIL', test.identity));

    const tick = await runtime.tick(10, DUE_AT);
    const other = await test.workflows.get('other-workflow');

    expect(tick.firedTimerIds).toContain('other-timer');
    expect(other?.steps[0]?.status).toBe('READY');
    expect(test.core.executions).toHaveLength(1);
  });
});
