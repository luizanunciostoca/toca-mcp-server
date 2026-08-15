import { createHash } from 'node:crypto';
import {
  requireEventEvidence,
  validateDomainEvent,
  type DomainEventEnvelope,
} from './transactional-outbox.js';

export interface DomainEventContext {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

export interface CreateDomainEventInput extends DomainEventContext {
  readonly eventType: string;
  readonly schemaVersion?: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly correlationId: string;
  readonly causationId?: string | null;
  readonly occurredAt: string;
  readonly payload: unknown;
  readonly evidence: readonly string[];
}

export function createDomainEvent(input: CreateDomainEventInput): DomainEventEnvelope {
  const event: DomainEventEnvelope = {
    eventId: deterministicDomainEventId({
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateVersion: input.aggregateVersion,
      correlationId: input.correlationId,
    }),
    eventType: input.eventType,
    schemaVersion: input.schemaVersion ?? '1.0.0',
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    occurredAt: input.occurredAt,
    payload: input.payload,
    evidence: requireEventEvidence(input.evidence),
  };
  validateDomainEvent(event);
  return event;
}

export function deterministicDomainEventId(input: {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly correlationId: string;
}): string {
  const canonical = [
    input.eventType.trim(),
    input.aggregateType.trim(),
    input.aggregateId.trim(),
    String(input.aggregateVersion),
    input.correlationId.trim(),
  ].join('|');
  return `evt_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}
