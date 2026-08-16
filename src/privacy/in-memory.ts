import type {
  PrivacyCapabilityId,
  PrivacyLedgerEvent,
  PrivacyLedgerStore,
  PrivacyPurposeDefinition,
  PrivacyPurposeRegistry,
  PrivacyScope,
} from './contracts.js';

export class InMemoryPrivacyLedgerStore implements PrivacyLedgerStore {
  readonly #events: PrivacyLedgerEvent[] = [];
  readonly #eventIds = new Set<string>();
  readonly #executionKeys = new Set<string>();

  append(event: PrivacyLedgerEvent): Promise<void> {
    return Promise.resolve().then(() => {
      this.#assertInsertable(event);
      this.#persist(event);
    });
  }

  appendConsentTransition(
    event: PrivacyLedgerEvent,
    expectedHeadEventId: string | null,
  ): Promise<void> {
    return Promise.resolve().then(() => {
      this.#assertInsertable(event);
      const current = this.#events
        .filter(
          (candidate) =>
            sameScope(candidate, event) &&
            candidate.subjectRef === event.subjectRef &&
            candidate.purposeId === event.purposeId &&
            candidate.channel === event.channel &&
            (candidate.eventType === 'CONSENT_RECORDED' ||
              candidate.eventType === 'CONSENT_REVOKED'),
        )
        .at(-1);
      if ((current?.eventId ?? null) !== expectedHeadEventId)
        throw new Error('PRIVACY_CONSENT_CONCURRENT_UPDATE');
      this.#persist(event);
    });
  }

  findByExecution(
    scope: PrivacyScope,
    executionId: string,
    capabilityId: PrivacyCapabilityId,
  ): Promise<PrivacyLedgerEvent | undefined> {
    return Promise.resolve(
      this.#events.find(
        (event) =>
          sameScope(event, scope) &&
          event.executionId === executionId &&
          event.capabilityId === capabilityId,
      ),
    );
  }

  listForSubject(scope: PrivacyScope, subjectRef: string): Promise<readonly PrivacyLedgerEvent[]> {
    validateScope(scope);
    return Promise.resolve(
      this.#events.filter((event) => sameScope(event, scope) && event.subjectRef === subjectRef),
    );
  }

  listForRequest(scope: PrivacyScope, requestId: string): Promise<readonly PrivacyLedgerEvent[]> {
    validateScope(scope);
    return Promise.resolve(
      this.#events.filter((event) => sameScope(event, scope) && event.requestId === requestId),
    );
  }

  #assertInsertable(event: PrivacyLedgerEvent): void {
    validateScope(event);
    const eventKey = `${event.tenantId}:${event.workspaceId}:${event.organizationId}:${event.eventId}`;
    if (this.#eventIds.has(eventKey)) throw new Error('PRIVACY_EVENT_DUPLICATE');
    const executionKey = executionKeyOf(event);
    if (this.#executionKeys.has(executionKey)) throw new Error('PRIVACY_EVENT_DUPLICATE');
  }

  #persist(event: PrivacyLedgerEvent): void {
    this.#eventIds.add(
      `${event.tenantId}:${event.workspaceId}:${event.organizationId}:${event.eventId}`,
    );
    this.#executionKeys.add(executionKeyOf(event));
    this.#events.push(freezeEvent(event));
  }
}

export class InMemoryPrivacyPurposeRegistry implements PrivacyPurposeRegistry {
  readonly #definitions = new Map<string, PrivacyPurposeDefinition>();

  constructor(definitions: readonly PrivacyPurposeDefinition[] = []) {
    for (const definition of definitions) this.put(definition);
  }

  put(definition: PrivacyPurposeDefinition): void {
    validateScope(definition);
    requireText(definition.purposeId, 'PRIVACY_PURPOSE_REQUIRED');
    requireText(definition.policyRef, 'PRIVACY_PURPOSE_POLICY_REQUIRED');
    if (definition.evidence.length === 0) throw new Error('PRIVACY_PURPOSE_EVIDENCE_REQUIRED');
    this.#definitions.set(scopeKey(definition, definition.purposeId), {
      ...definition,
      evidence: [...definition.evidence],
    });
  }

  resolve(scope: PrivacyScope, purposeId: string): Promise<PrivacyPurposeDefinition | undefined> {
    validateScope(scope);
    return Promise.resolve(this.#definitions.get(scopeKey(scope, purposeId)));
  }
}

function freezeEvent(event: PrivacyLedgerEvent): PrivacyLedgerEvent {
  return Object.freeze({
    ...event,
    evidence: Object.freeze([...event.evidence]),
    payload: Object.freeze({ ...event.payload }),
  });
}

function executionKeyOf(event: PrivacyLedgerEvent): string {
  return [
    event.tenantId,
    event.workspaceId,
    event.organizationId,
    event.executionId,
    event.capabilityId,
  ].join(':');
}

function scopeKey(scope: PrivacyScope, suffix: string): string {
  return [scope.tenantId, scope.workspaceId, scope.organizationId, suffix].join(':');
}

function sameScope(left: PrivacyScope, right: PrivacyScope): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.workspaceId === right.workspaceId &&
    left.organizationId === right.organizationId
  );
}

function validateScope(scope: PrivacyScope): void {
  requireText(scope.tenantId, 'PRIVACY_TENANT_REQUIRED');
  requireText(scope.workspaceId, 'PRIVACY_WORKSPACE_REQUIRED');
  requireText(scope.organizationId, 'PRIVACY_ORGANIZATION_REQUIRED');
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
