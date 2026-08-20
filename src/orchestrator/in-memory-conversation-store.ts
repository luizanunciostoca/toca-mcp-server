import type {
  CircuitBreakerState,
  ConversationRecord,
  ConversationStore,
  MessageRecord,
  OrchestratorConversationStatus,
  OrchestratorCheckpoint,
} from './contracts.js';

export class InMemoryConversationStore implements ConversationStore {
  readonly #conversations = new Map<string, ConversationRecord>();
  readonly #messages = new Map<string, MessageRecord[]>();
  readonly #idempotency = new Map<string, MessageRecord>();
  readonly #circuits = new Map<string, CircuitBreakerState>();

  createConversation(record: ConversationRecord): Promise<ConversationRecord> {
    const key = conversationKey(record.tenantId, record.conversationId);
    const existing = this.#conversations.get(key);
    if (existing) return Promise.resolve(existing);
    this.#conversations.set(key, clone(record));
    return Promise.resolve(clone(record));
  }

  getConversation(
    tenantId: string,
    conversationId: string,
  ): Promise<ConversationRecord | undefined> {
    const record = this.#conversations.get(conversationKey(tenantId, conversationId));
    return Promise.resolve(record ? clone(record) : undefined);
  }

  appendMessage(
    record: MessageRecord,
  ): Promise<{ readonly record: MessageRecord; readonly duplicate: boolean }> {
    const idemKey = `${record.tenantId}\u001f${record.idempotencyKey}`;
    const existing = this.#idempotency.get(idemKey);
    if (existing) {
      if (
        existing.sourceContentSha256 !== record.sourceContentSha256 ||
        existing.conversationId !== record.conversationId
      ) {
        throw new Error('AG01_MESSAGE_IDEMPOTENCY_CONFLICT');
      }
      return Promise.resolve({ record: clone(existing), duplicate: true });
    }
    const key = conversationKey(record.tenantId, record.conversationId);
    if (!this.#conversations.has(key)) throw new Error('AG01_CONVERSATION_NOT_FOUND');
    const messages = this.#messages.get(key) ?? [];
    if (messages.some((message) => message.messageId === record.messageId)) {
      throw new Error('AG01_MESSAGE_ALREADY_EXISTS');
    }
    const persisted = clone(record);
    this.#messages.set(key, [...messages, persisted]);
    this.#idempotency.set(idemKey, persisted);
    return Promise.resolve({ record: clone(persisted), duplicate: false });
  }

  listMessages(
    tenantId: string,
    conversationId: string,
    limit: number,
  ): Promise<readonly MessageRecord[]> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('AG01_MESSAGE_LIMIT_INVALID');
    const messages = this.#messages.get(conversationKey(tenantId, conversationId)) ?? [];
    return Promise.resolve(messages.slice(-limit).map(clone));
  }

  updateConversation(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly expectedVersion: number;
    readonly status: OrchestratorConversationStatus;
    readonly humanReason: string | null;
    readonly routeId: ConversationRecord['routeId'];
    readonly primaryAgent: string | null;
    readonly sopId: string | null;
    readonly templateId: string | null;
    readonly contextSummary: string;
    readonly summarizedMessageCount: number;
    readonly checkpoint: OrchestratorCheckpoint | null;
    readonly now: string;
  }): Promise<ConversationRecord> {
    const key = conversationKey(input.tenantId, input.conversationId);
    const current = this.#conversations.get(key);
    if (!current) throw new Error('AG01_CONVERSATION_NOT_FOUND');
    if (current.version !== input.expectedVersion)
      throw new Error('AG01_CONVERSATION_VERSION_CONFLICT');
    const next: ConversationRecord = {
      ...current,
      status: input.status,
      humanReason: input.humanReason,
      routeId: input.routeId,
      primaryAgent: input.primaryAgent,
      sopId: input.sopId,
      templateId: input.templateId,
      contextSummary: input.contextSummary,
      summarizedMessageCount: input.summarizedMessageCount,
      checkpoint: input.checkpoint ? clone(input.checkpoint) : null,
      updatedAt: input.now,
      version: current.version + 1,
    };
    this.#conversations.set(key, next);
    return Promise.resolve(clone(next));
  }

  getCircuit(tenantId: string, capabilityId: string): Promise<CircuitBreakerState | undefined> {
    const value = this.#circuits.get(circuitKey(tenantId, capabilityId));
    return Promise.resolve(value ? clone(value) : undefined);
  }

  recordCircuitFailure(input: {
    readonly tenantId: string;
    readonly capabilityId: string;
    readonly errorCode: string;
    readonly threshold: number;
    readonly openedUntil: string;
    readonly now: string;
  }): Promise<CircuitBreakerState> {
    const key = circuitKey(input.tenantId, input.capabilityId);
    const previous = this.#circuits.get(key);
    const failureCount = (previous?.failureCount ?? 0) + 1;
    const next: CircuitBreakerState = {
      tenantId: input.tenantId,
      capabilityId: input.capabilityId,
      failureCount,
      openedUntil: failureCount >= input.threshold ? input.openedUntil : null,
      lastFailureCode: input.errorCode,
      updatedAt: input.now,
    };
    this.#circuits.set(key, next);
    return Promise.resolve(clone(next));
  }

  resetCircuit(tenantId: string, capabilityId: string, now: string): Promise<void> {
    const key = circuitKey(tenantId, capabilityId);
    const previous = this.#circuits.get(key);
    if (previous) {
      this.#circuits.set(key, {
        ...previous,
        failureCount: 0,
        openedUntil: null,
        lastFailureCode: null,
        updatedAt: now,
      });
    }
    return Promise.resolve();
  }
}

function conversationKey(tenantId: string, conversationId: string): string {
  return `${tenantId}\u001f${conversationId}`;
}

function circuitKey(tenantId: string, capabilityId: string): string {
  return `${tenantId}\u001f${capabilityId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
