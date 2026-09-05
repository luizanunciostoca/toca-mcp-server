import { describe, expect, it } from 'vitest';
import {
  createInMemoryAppGatewayActionRuntimeStore,
  type AppGatewayActionOwner,
  type TocaAction,
} from '../src/app-gateway/index.js';

const ownerA: AppGatewayActionOwner = { subject: 'user-a', tenantId: 'toca' };
const ownerB: AppGatewayActionOwner = { subject: 'user-b', tenantId: 'toca' };

function action(actionId: string): TocaAction {
  return {
    actionId,
    correlationId: `corr-${actionId}`,
    request: {
      action_type: 'CREATE_CONTENT',
      operation: 'THE_PARTY',
      objective: 'Preparar conteúdo',
      mode: 'AUTO',
      inputs: {},
    },
    state: 'READY',
    availability: 'AVAILABLE',
    approvalHint: false,
    reasons: [],
    createdAt: '2026-09-05T09:00:00.000Z',
  };
}

describe('App Gateway bounded action runtime store', () => {
  it('returns an action only to the bound subject and tenant', () => {
    const store = createInMemoryAppGatewayActionRuntimeStore();
    store.put(action('ACT-1'), ownerA);

    expect(store.get('ACT-1', ownerA)?.actionId).toBe('ACT-1');
    expect(store.get('ACT-1', ownerB)).toBeUndefined();
    expect(store.get('ACT-1', { subject: 'user-a', tenantId: 'other' })).toBeUndefined();
    expect(store.get('ACT-1', { subject: ' user-a ', tenantId: ' toca ' })?.actionId).toBe(
      'ACT-1',
    );
  });

  it('expires records after the configured TTL', () => {
    let now = 1_000;
    const store = createInMemoryAppGatewayActionRuntimeStore({
      ttlMs: 100,
      nowEpochMs: () => now,
    });
    store.put(action('ACT-TTL'), ownerA);

    now = 1_099;
    expect(store.get('ACT-TTL', ownerA)?.actionId).toBe('ACT-TTL');

    now = 1_100;
    expect(store.get('ACT-TTL', ownerA)).toBeUndefined();
  });

  it('evicts the oldest records when capacity is exceeded', () => {
    const store = createInMemoryAppGatewayActionRuntimeStore({ capacity: 2 });
    store.put(action('ACT-1'), ownerA);
    store.put(action('ACT-2'), ownerA);
    store.put(action('ACT-3'), ownerA);

    expect(store.get('ACT-1', ownerA)).toBeUndefined();
    expect(store.get('ACT-2', ownerA)?.actionId).toBe('ACT-2');
    expect(store.get('ACT-3', ownerA)?.actionId).toBe('ACT-3');
  });

  it('fails closed on invalid owner or unbounded configuration', () => {
    const store = createInMemoryAppGatewayActionRuntimeStore();
    expect(() => store.put(action('ACT-1'), { subject: '   ' })).toThrow(
      'APP_GATEWAY_ACTION_OWNER_REQUIRED',
    );

    expect(() => createInMemoryAppGatewayActionRuntimeStore({ ttlMs: 0 })).toThrow(
      'APP_GATEWAY_ACTION_STORE_CONFIGURATION_INVALID',
    );
    expect(() => createInMemoryAppGatewayActionRuntimeStore({ capacity: 5_001 })).toThrow(
      'APP_GATEWAY_ACTION_STORE_CONFIGURATION_INVALID',
    );
  });
});
