import { describe, expect, it } from 'vitest';
import type {
  ConversationRecord,
  MessageRecord,
  OrchestratorCheckpoint,
} from '../src/orchestrator/contracts.js';
import { PostgresConversationStore } from '../src/orchestrator/postgres-conversation-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;
const BASE = '2026-08-20T05:10:00.000Z';

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('AG01_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('AG-01 PostgreSQL conversation durability E2E', () => {
  it('survives restart with checkpoint, MessageRecord idempotency and circuit state intact', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantId = `ag01-tenant-${suffix}`;
    const conversationId = `ag01-conversation-${suffix}`;
    const correlationId = `ag01-correlation-${suffix}`;
    const idempotencyKey = `ag01-message-idem-${suffix}`;
    const checkpoint: OrchestratorCheckpoint = {
      runId: `ag01-run-${suffix}`,
      messageId: `ag01-message-${suffix}`,
      correlationId,
      causationId: null,
      plan: {
        routeId: 'R17',
        primaryAgent: 'AG-15',
        auxiliaryAgents: ['AG-01'],
        sop: {
          artifactId: 'SOP-R17-E2E',
          version: '1.0.0',
          sourceRef: 'TOCA_OS/SOP-R17-E2E',
          evidence: ['e2e:sop:canonical'],
        },
        template: null,
        steps: [
          {
            stepId: 'inspect-runtime',
            name: 'Inspect runtime',
            capabilityId: 'system.health',
            payload: { source: 'ag01-postgres-e2e' },
            maxAttempts: 2,
          },
        ],
        evidence: ['e2e:route:R17', 'e2e:sop:canonical'],
      },
      nextStepIndex: 0,
      currentAttempt: 0,
      totalToolCalls: 0,
      approvalId: null,
      status: 'READY',
      humanReason: null,
      lastErrorCode: null,
      updatedAt: BASE,
    };
    const conversation: ConversationRecord = {
      conversationId,
      tenantId,
      workspaceId: `ag01-workspace-${suffix}`,
      organizationId: `ag01-organization-${suffix}`,
      userPrincipalId: `ag01-user-${suffix}`,
      correlationId,
      status: 'ACTIVE',
      humanReason: null,
      routeId: 'R17',
      primaryAgent: 'AG-15',
      sopId: 'SOP-R17-E2E',
      templateId: null,
      contextSummary: 'USER: inspect runtime',
      summarizedMessageCount: 1,
      checkpoint,
      createdAt: BASE,
      updatedAt: BASE,
      version: 1,
    };
    const message: MessageRecord = {
      messageId: checkpoint.messageId,
      conversationId,
      tenantId,
      userPrincipalId: conversation.userPrincipalId,
      role: 'USER',
      content: 'Contact [REDACTED_EMAIL] and inspect runtime.',
      sourceContentSha256: 'a'.repeat(64),
      correlationId,
      causationId: null,
      idempotencyKey,
      promptInjectionDetected: false,
      redactionCount: 1,
      createdAt: BASE,
    };

    const pool1 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    const store1 = new PostgresConversationStore(pool1);
    const created = await store1.createConversation(conversation);
    expect(created.checkpoint?.status).toBe('READY');
    const firstAppend = await store1.appendMessage(message);
    expect(firstAppend.duplicate).toBe(false);
    const firstCircuit = await store1.recordCircuitFailure({
      tenantId,
      capabilityId: 'system.health',
      errorCode: 'PROVIDER_UNAVAILABLE',
      threshold: 2,
      openedUntil: '2026-08-20T05:20:00.000Z',
      now: '2026-08-20T05:10:01.000Z',
    });
    expect(firstCircuit.openedUntil).toBeNull();
    const openedCircuit = await store1.recordCircuitFailure({
      tenantId,
      capabilityId: 'system.health',
      errorCode: 'PROVIDER_UNAVAILABLE',
      threshold: 2,
      openedUntil: '2026-08-20T05:20:00.000Z',
      now: '2026-08-20T05:10:02.000Z',
    });
    expect(openedCircuit.failureCount).toBe(2);
    expect(openedCircuit.openedUntil).toBe('2026-08-20T05:20:00.000Z');
    await pool1.end();

    const pool2 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    const store2 = new PostgresConversationStore(pool2);
    const recovered = await store2.getConversation(tenantId, conversationId);
    expect(recovered).toMatchObject({
      conversationId,
      tenantId,
      routeId: 'R17',
      primaryAgent: 'AG-15',
      version: 1,
    });
    expect(recovered?.checkpoint).toEqual(checkpoint);

    const recoveredMessages = await store2.listMessages(tenantId, conversationId, 10);
    expect(recoveredMessages).toHaveLength(1);
    expect(recoveredMessages[0]).toMatchObject({
      messageId: message.messageId,
      content: 'Contact [REDACTED_EMAIL] and inspect runtime.',
      redactionCount: 1,
    });

    const duplicate = await store2.appendMessage(message);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.record.messageId).toBe(message.messageId);

    const recoveredCircuit = await store2.getCircuit(tenantId, 'system.health');
    expect(recoveredCircuit).toMatchObject({
      failureCount: 2,
      lastFailureCode: 'PROVIDER_UNAVAILABLE',
      openedUntil: '2026-08-20T05:20:00.000Z',
    });

    if (!recovered) throw new Error('AG01_RECOVERED_CONVERSATION_REQUIRED');
    const escalated = await store2.updateConversation({
      tenantId,
      conversationId,
      expectedVersion: recovered.version,
      status: 'HUMAN_REQUIRED',
      humanReason: 'E2E_RESTART_ESCALATION',
      routeId: recovered.routeId,
      primaryAgent: recovered.primaryAgent,
      sopId: recovered.sopId,
      templateId: recovered.templateId,
      contextSummary: recovered.contextSummary,
      summarizedMessageCount: recovered.summarizedMessageCount,
      checkpoint: {
        ...checkpoint,
        status: 'HUMAN_REQUIRED',
        humanReason: 'E2E_RESTART_ESCALATION',
        updatedAt: '2026-08-20T05:10:03.000Z',
      },
      now: '2026-08-20T05:10:03.000Z',
    });
    expect(escalated).toMatchObject({
      status: 'HUMAN_REQUIRED',
      humanReason: 'E2E_RESTART_ESCALATION',
      version: 2,
    });

    const nullCheckpointId = `ag01-null-checkpoint-${suffix}`;
    const nullCheckpoint = await store2.createConversation({
      ...conversation,
      conversationId: nullCheckpointId,
      correlationId: `${correlationId}-null`,
      status: 'ACTIVE',
      humanReason: null,
      routeId: null,
      primaryAgent: null,
      sopId: null,
      checkpoint: null,
      contextSummary: '',
      summarizedMessageCount: 0,
    });
    expect(nullCheckpoint.checkpoint).toBeNull();
    await pool2.end();
  });
});
