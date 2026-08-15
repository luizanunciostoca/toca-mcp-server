import type {
  PrivacyLedgerEvent,
  PrivacyLedgerStore,
  PrivacyPurposeDefinition,
  PrivacyPurposeRegistry,
} from './contracts.js';

export class InMemoryPrivacyLedgerStore implements PrivacyLedgerStore {
  readonly #events: PrivacyLedgerEvent[] = [];
  readonly #eventIds = new Set<string>();

  append(event: PrivacyLedgerEvent): Promise<void> {
    return Promise.resolve().then(() => {
      const key = `${event.tenantId}:${event.eventId}`;
      if (this.#eventIds.has(key)) throw new Error('PRIVACY_EVENT_DUPLICATE');
      this.#eventIds.add(key);
      this.#events.push(freezeEvent(event));
    });
  }

  listForSubject(tenantId: string, subjectRef: string): Promise<readonly PrivacyLedgerEvent[]> {
    return Promise.resolve(
      this.#events
        .filter((event) => event.tenantId === tenantId && event.subjectRef === subjectRef)
        .slice()
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    );
  }

  listForRequest(tenantId: string, requestId: string): Promise<readonly PrivacyLedgerEvent[]> {
    return Promise.resolve(
      this.#events
        .filter((event) => event.tenantId === tenantId && event.requestId === requestId)
        .slice()
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    );
  }
}

export class InMemoryPrivacyPurposeRegistry implements PrivacyPurposeRegistry {
  readonly #definitions = new Map<string, PrivacyPurposeDefinition>();

  constructor(definitions: readonly PrivacyPurposeDefinition[] = []) {
    for (const definition of definitions) this.put(definition);
  }

  put(definition: PrivacyPurposeDefinition): void {
    requireText(definition.tenantId, 'PRIVACY_TENANT_REQUIRED');
    requireText(definition.purposeId, 'PRIVACY_PURPOSE_REQUIRED');
    requireText(definition.policyRef, 'PRIVACY_PURPOSE_POLICY_REQUIRED');
    if (definition.evidence.length === 0) throw new Error('PRIVACY_PURPOSE_EVIDENCE_REQUIRED');
    this.#definitions.set(`${definition.tenantId}:${definition.purposeId}`, {
      ...definition,
      evidence: [...definition.evidence],
    });
  }

  resolve(tenantId: string, purposeId: string): Promise<PrivacyPurposeDefinition | undefined> {
    return Promise.resolve(this.#definitions.get(`${tenantId}:${purposeId}`));
  }
}

function freezeEvent(event: PrivacyLedgerEvent): PrivacyLedgerEvent {
  return Object.freeze({
    ...event,
    evidence: Object.freeze([...event.evidence]),
    payload: Object.freeze({ ...event.payload }),
  });
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
