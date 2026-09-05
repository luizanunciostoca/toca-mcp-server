import type { TocaAction } from './contracts.js';

const DEFAULT_ACTION_RUNTIME_TTL_MS = 30 * 60_000;
const DEFAULT_ACTION_RUNTIME_CAPACITY = 200;
const MAX_ACTION_RUNTIME_TTL_MS = 24 * 60 * 60_000;
const MAX_ACTION_RUNTIME_CAPACITY = 5_000;

export interface AppGatewayActionOwner {
  readonly subject: string;
  readonly tenantId?: string;
}

export interface AppGatewayActionRuntimeStore {
  put(action: TocaAction, owner: AppGatewayActionOwner): void;
  get(actionId: string, owner: AppGatewayActionOwner): TocaAction | undefined;
}

export interface InMemoryAppGatewayActionRuntimeStoreOptions {
  readonly ttlMs?: number;
  readonly capacity?: number;
  readonly nowEpochMs?: () => number;
}

interface StoredAction {
  readonly action: TocaAction;
  readonly owner: AppGatewayActionOwner;
  readonly expiresAtMs: number;
}

export function createInMemoryAppGatewayActionRuntimeStore(
  options: InMemoryAppGatewayActionRuntimeStoreOptions = {},
): AppGatewayActionRuntimeStore {
  const ttlMs = boundedInteger(
    options.ttlMs ?? DEFAULT_ACTION_RUNTIME_TTL_MS,
    1,
    MAX_ACTION_RUNTIME_TTL_MS,
  );
  const capacity = boundedInteger(
    options.capacity ?? DEFAULT_ACTION_RUNTIME_CAPACITY,
    1,
    MAX_ACTION_RUNTIME_CAPACITY,
  );
  const nowEpochMs = options.nowEpochMs ?? Date.now;
  const actions = new Map<string, StoredAction>();

  const pruneExpired = (): void => {
    const now = nowEpochMs();
    for (const [actionId, record] of actions) {
      if (record.expiresAtMs <= now) actions.delete(actionId);
    }
  };

  return {
    put(action, owner) {
      pruneExpired();
      const normalizedOwner = normalizeOwner(owner);
      actions.delete(action.actionId);
      actions.set(action.actionId, {
        action,
        owner: normalizedOwner,
        expiresAtMs: nowEpochMs() + ttlMs,
      });
      while (actions.size > capacity) {
        const oldestActionId = actions.keys().next().value as string | undefined;
        if (!oldestActionId) break;
        actions.delete(oldestActionId);
      }
    },

    get(actionId, owner) {
      pruneExpired();
      const record = actions.get(actionId);
      if (!record) return undefined;
      const normalizedOwner = normalizeOwner(owner);
      if (
        record.owner.subject !== normalizedOwner.subject ||
        record.owner.tenantId !== normalizedOwner.tenantId
      ) {
        return undefined;
      }
      return record.action;
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

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error('APP_GATEWAY_ACTION_STORE_CONFIGURATION_INVALID');
  }
  return value;
}
