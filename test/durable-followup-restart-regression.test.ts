import { describe, expect, it } from 'vitest';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import type { CrmScope } from '../src/crm/crm-records.js';
import type {
  CrmSalesStore,
  NextActionRecord,
  SalesActivityRecord,
} from '../src/crm/sales-engine.js';
import type { CoreCapabilityGateway } from '../src/orchestrator/contracts.js';
import { DurableFollowupCoordinator } from '../src/orchestrator/durable-followup.js';
import { InMemoryWorkflowStore } from '../src/workflow/in-memory-workflow-store.js';
import type { DeadLetterRecord, DeadLetterSink } from '../src/worker/worker.js';

const SCOPE: CrmScope = {
  tenantId: 'tenant-regression',
  workspaceId: 'workspace-regression',
  organizationId: 'organization-regression',
};
const DUE_AT = '2026-08-22T18:00:00.000Z';
const BEFORE_DUE = '2026-08-22T17:00:00.000Z';
const CORRELATION_ID = 'corr-durable-followup-regression';
const APPROVAL_ID = 'approval-durable-followup-regression';

const identity = createTrustedServiceExecutionIdentity({
  principalId: 'ag01-regression',
  tenantId: SCOPE.tenantId,
  workspaceId: SCOPE.workspaceId,
  organizationId: SCOPE.organizationId,
  roles: ['ADMIN'],
  allowedRouteIds: null,
  allowedCapabilityIds: null,
  allowedTargetAccounts: null,
  evidence: ['test:durable-followup-regression'],
  now: BEFORE_DUE,
});

function nextAction(dueAt = DUE_AT): NextActionRecord {
  return {
    ...SCOPE,
    nextActionId: 'next-action-regression',
    contactId: 'contact-regression',
    leadId: 'lead-regression',
    opportunityId: null,
    actionType: 'FOLLOW_UP',
    title: 'Regression follow-up',
    rationale: 'Acceptance regression coverage.',
    priority: 'HIGH',
    status: 'PENDING',
    ownerPrincipalId: identity.principal.principalId,
    playbookKey: 'follow-up-v1',
    dueAt,
    completedAt: null,
    version: 1,
    createdAt: BEFORE_DUE,
    updatedAt: BEFORE_DUE,
  };
}

class FakeSalesStore {
  action = nextAction();
  readonly activities: Array<Parameters<CrmSalesStore['appendActivity']>[0]> = [];

  getNextAction(
    input: CrmScope & { readonly nextActionId: string },
  ): Promise<NextActionRecord | undefined> {
    if (
      input.tenantId !== SCOPE.tenantId ||
      input.workspaceId !== SCOPE.workspaceId ||
      input.organizationId !== SCOPE.organizationId ||
      input.nextActionId !== this.action.nextActionId
    ) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.action);
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

class FakeCore {
  readonly executions: Array<Parameters<CoreCapabilityGateway['execute']>[0]> = [];

  async execute(input: Parameters<CoreCapabilityGateway['execute']>[0]) {
    await Promise.resolve();
    this.executions.push(input);
    return {
      executionId: `fake-execution-${this.executions.length}`,
      capabilityId: input.capabilityId,
      result: {
        state: 'ACCEPTED',
        provider_dispatch_id: `fake-provider-${this.executions.length}`,
      },
      providerReadbackVerified: true,
    };
  }

  asGateway(): CoreCapabilityGateway {
    return this as unknown as CoreCapabilityGateway;
  }
}

class RejectingDeadLetters implements DeadLetterSink {
  readonly records: DeadLetterRecord[] = [];

  put(record: DeadLetterRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
}

function outboundPayload() {
  return {
    tenant_id: SCOPE.tenantId,
    workspace_id: SCOPE.workspaceId,
    organization_id: SCOPE.organizationId,
    correlation_id: CORRELATION_ID,
    approval_id: APPROVAL_ID,
    idempotency_key: 'followup-regression-idempotency',
    message_id: 'followup-regression-message',
    prepared_campaign_id: 'prepared-campaign-regression',
  };
}

function scheduleInput(now = BEFORE_DUE) {
  return {
    ...SCOPE,
    nextActionId: 'next-action-regression',
    channel: 'EMAIL' as const,
    outboundPayload: outboundPayload(),
    approvalId: APPROVAL_ID,
    correlationId: CORRELATION_ID,
    identity,
    evidence: ['test:durable-followup-regression'],
    maxAttempts: 3,
    now,
  };
}

function fixture() {
  const workflows = new InMemoryWorkflowStore();
  const sales = new FakeSalesStore();
  const core = new FakeCore();
  const deadLetters = new RejectingDeadLetters();
  const coordinator = () =>
    new DurableFollowupCoordinator({
      workflows,
      sales: sales.asStore(),
      core: core.asGateway(),
      deadLetters,
      resolveIdentity: () => identity,
      retry: { baseDelayMs: 1_000, maxDelayMs: 4_000 },
    });
  return { workflows, sales, core, deadLetters, coordinator };
}

describe('durable follow-up restart regressions', () => {
  it('redelivers a fired timer after crash-before-claim and resumes exactly once', async () => {
    const test = fixture();
    const scheduled = await test.coordinator().schedule(scheduleInput());
    const timerId = scheduled.timers[0]?.timerId;
    expect(timerId).toBeDefined();

    // Simulate the process committing fireDueTimers and crashing before the
    // DurableFollowupCoordinator can claim/process the READY step.
    expect(await test.workflows.fireDueTimers({ now: DUE_AT, limit: 10 })).toContain(timerId);
    const stranded = await test.workflows.get(scheduled.instance.workflowId);
    expect(stranded?.steps[0]?.status).toBe('READY');
    expect(stranded?.timers[0]?.status).toBe('FIRED');
    expect(test.core.executions).toHaveLength(0);

    const restartedRuntime = test.coordinator();
    const recoveredTick = await restartedRuntime.tick(10, DUE_AT);
    expect(recoveredTick.firedTimerIds).toContain(timerId);
    expect(recoveredTick.processedWorkflowIds).toEqual([scheduled.instance.workflowId]);
    expect(test.core.executions).toHaveLength(1);
    expect(test.sales.activities).toHaveLength(1);

    const final = await test.workflows.get(scheduled.instance.workflowId);
    expect(final?.instance.status).toBe('SUCCEEDED');
    expect(final?.events.filter((event) => event.eventType === 'TIMER_FIRED')).toHaveLength(1);

    const duplicateTick = await restartedRuntime.tick(10, '2026-08-22T18:01:00.000Z');
    expect(duplicateTick.processedWorkflowIds).toHaveLength(0);
    expect(test.core.executions).toHaveLength(1);
    expect(test.sales.activities).toHaveLength(1);
  });

  it('reconciles an already-armed timer when NextAction dueAt moves earlier or later', async () => {
    const test = fixture();
    const runtime = test.coordinator();
    const first = await runtime.schedule(scheduleInput());
    const timerId = first.timers[0]?.timerId;
    expect(timerId).toBeDefined();
    expect(first.timers[0]?.fireAt).toBe(DUE_AT);

    test.sales.action = {
      ...test.sales.action,
      dueAt: '2026-08-22T17:30:00.000Z',
      version: 2,
      updatedAt: '2026-08-22T17:10:00.000Z',
    };
    const movedEarlier = await runtime.schedule(scheduleInput('2026-08-22T17:10:00.000Z'));
    expect(movedEarlier.timers).toHaveLength(1);
    expect(movedEarlier.timers[0]?.timerId).toBe(timerId);
    expect(movedEarlier.timers[0]?.fireAt).toBe('2026-08-22T17:30:00.000Z');

    test.sales.action = {
      ...test.sales.action,
      dueAt: '2026-08-22T18:30:00.000Z',
      version: 3,
      updatedAt: '2026-08-22T17:15:00.000Z',
    };
    const movedLater = await runtime.schedule(scheduleInput('2026-08-22T17:15:00.000Z'));
    expect(movedLater.timers).toHaveLength(1);
    expect(movedLater.timers[0]?.timerId).toBe(timerId);
    expect(movedLater.timers[0]?.fireAt).toBe('2026-08-22T18:30:00.000Z');

    await runtime.tick(10, DUE_AT);
    expect(test.core.executions).toHaveLength(0);
    await runtime.tick(10, '2026-08-22T18:30:00.000Z');
    expect(test.core.executions).toHaveLength(1);
    expect(test.sales.activities).toHaveLength(1);
  });
});
