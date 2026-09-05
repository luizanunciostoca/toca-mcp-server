import type { TocaActionEvent } from './contracts.js';
import type { AppGatewayActionOwner } from './action-runtime-store.js';

const DEFAULT_EVENT_RUNTIME_TTL_MS = 30 * 60_000;
const DEFAULT_EVENT_ACTION_CAPACITY = 200;
const DEFAULT_EVENTS_PER_ACTION = 100;
const MAX_EVENT_RUNTIME_TTL_MS = 24 * 60 * 60_000;
const MAX_EVENT_ACTION_CAPACITY = 5_000;
const MAX_EVENTS_PER_ACTION = 1_000;

export type AppGatewayActionEventListener = (event: TocaActionEvent) => void;

export interface AppGatewayActionEventRuntimeStore {
  append(actionId: string, owner: AppGatewayActionOwner, event: TocaActionEvent): void;
  listAfter(
    actionId: string,
    owner: AppGatewayActionOwner,
    lastEventId?: string,
  ): readonly TocaActionEvent[] | undefined;
  subscribe(
    actionId: string,
    owner: AppGatewayActionOwner,
    listener: AppGatewayActionEventListener,
  ): (() => void) | undefined;
}

export interface InMemoryAppGatewayActionEventRuntimeStoreOptions {
  readonly ttlMs?: number;
  readonly actionCapacity?: number;
  readonly eventsPerAction?: number;
  readonly nowEpochMs?: () => number;
}

interface EventRecord {
  readonly owner: AppGatewayActionOwner;
  readonly events: TocaActionEvent[];
  readonly listeners: Set<AppGatewayActionEventListener>;
  expiresAtMs: number;
}

export function createInMemoryAppGatewayActionEventRuntimeStore(
  options: InMemoryAppGatewayActionEventRuntimeStoreOptions = {},
): AppGatewayActionEventRuntimeStore {
  const ttlMs = boundedInteger(
    options.ttlMs ?? DEFAULT_EVENT_RUNTIME_TTL_MS,
    1,
    MAX_EVENT_RUNTIME_TTL_MS,
  );
  const actionCapacity = boundedInteger(
    options.actionCapacity ?? DEFAULT_EVENT_ACTION_CAPACITY,
    1,
    MAX_EVENT_ACTION_CAPACITY,
  );
  const eventsPerAction = boundedInteger(
    options.eventsPerAction ?? DEFAULT_EVENTS_PER_ACTION,
    1,
    MAX_EVENTS_PER_ACTION,
  );
  const nowEpochMs = options.nowEpochMs ?? Date.now;
  const records = new Map<string, EventRecord>();

  const pruneExpired = (): void => {
    const now = nowEpochMs();
    for (const [actionId, record] of records) {
      if (record.expiresAtMs <= now) records.delete(actionId);
    }
  };

  const getOwnedRecord = (
    actionId: string,
    owner: AppGatewayActionOwner,
  ): EventRecord | undefined => {
    pruneExpired();
    const record = records.get(actionId);
    if (!record) return undefined;
    return sameOwner(record.owner, normalizeOwner(owner)) ? record : undefined;
  };

  return {
    append(actionId, owner, event) {
      pruneExpired();
      const normalizedOwner = normalizeOwner(owner);
      const existing = records.get(actionId);
      if (existing && !sameOwner(existing.owner, normalizedOwner)) {
        throw new Error('APP_GATEWAY_ACTION_EVENT_OWNER_MISMATCH');
      }

      const record = existing ?? {
        owner: normalizedOwner,
        events: [],
        listeners: new Set<AppGatewayActionEventListener>(),
        expiresAtMs: nowEpochMs() + ttlMs,
      };
      record.expiresAtMs = nowEpochMs() + ttlMs;
      record.events.push(event);
      if (record.events.length > eventsPerAction) {
        record.events.splice(0, record.events.length - eventsPerAction);
      }

      if (!existing) {
        records.set(actionId, record);
        while (records.size > actionCapacity) {
          const oldestActionId = records.keys().next().value;
          if (!oldestActionId) break;
          records.delete(oldestActionId);
        }
      }

      for (const listener of record.listeners) listener(event);
    },

    listAfter(actionId, owner, lastEventId) {
      const record = getOwnedRecord(actionId, owner);
      if (!record) return undefined;
      if (!lastEventId) return [...record.events];
      const index = record.events.findIndex((event) => event.eventId === lastEventId);
      if (index < 0) return [...record.events];
      return record.events.slice(index + 1);
    },

    subscribe(actionId, owner, listener) {
      const record = getOwnedRecord(actionId, owner);
      if (!record) return undefined;
      record.listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        record.listeners.delete(listener);
      };
    },
  };
}

function normalizeOwner(owner: AppGatewayActionOwner): AppGatewayActionOwner {
  const subject = owner.subject.trim();
  if (!subject) throw new Error('APP_GATEWAY_ACTION_OWNER_REQUIRED');
  const tenantId = owner.tenantId?.trim();
  return {
    subject,
    ...(tenantId ? { tenantId } : {}),
  };
}

function sameOwner(left: AppGatewayActionOwner, right: AppGatewayActionOwner): boolean {
  return left.subject === right.subject && left.tenantId === right.tenantId;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error('APP_GATEWAY_ACTION_EVENT_STORE_CONFIGURATION_INVALID');
  }
  return value;
}
