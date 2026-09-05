import { describe, expect, it } from 'vitest';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import {
  actionStateFromExecutionPhase,
  capabilityStatusToAvailability,
  createTocaActionEvent,
  listActionCards,
  prepareTocaAction,
} from '../src/app-gateway/index.js';

function tool(overrides: Partial<ToolDefinition> & Pick<ToolDefinition, 'name'>): ToolDefinition {
  return {
    name: overrides.name,
    version: overrides.version ?? '1.0.0',
    provider: overrides.provider ?? 'test',
    riskClass: overrides.riskClass ?? 'READ',
    requiredScopes: overrides.requiredScopes ?? [],
    capabilityStatus: overrides.capabilityStatus ?? 'PRODUCTION_VALIDATED',
    sideEffects: overrides.sideEffects ?? false,
    idempotent: overrides.idempotent ?? true,
  };
}

function baseRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(tool({ name: 'system.capabilities' }));
  return registry;
}

describe('Android app gateway contracts', () => {
  it('maps capability lifecycle to a fail-closed client availability', () => {
    expect(capabilityStatusToAvailability('PRODUCTION_VALIDATED')).toBe('AVAILABLE');
    expect(capabilityStatusToAvailability('CONNECTED')).toBe('LIMITED');
    expect(capabilityStatusToAvailability('IMPLEMENTED')).toBe('UNAVAILABLE');
    expect(capabilityStatusToAvailability('BLOCKED')).toBe('BLOCKED');
    expect(capabilityStatusToAvailability('RETIRED')).toBe('BLOCKED');
  });

  it('does not advertise Create Content as executable when no production path is registered', () => {
    const createContent = listActionCards(baseRegistry()).find(
      (card) => card.actionType === 'CREATE_CONTENT',
    );

    expect(createContent).toBeDefined();
    expect(createContent?.availability).toBe('UNAVAILABLE');
  });

  it('advertises Create Content when at least one production-valid execution path is available', () => {
    const registry = baseRegistry();
    registry.register(tool({ name: 'copy.generate' }));

    const createContent = listActionCards(registry).find(
      (card) => card.actionType === 'CREATE_CONTENT',
    );

    expect(createContent?.availability).toBe('AVAILABLE');
  });

  it('keeps a connected-but-not-production path limited', () => {
    const registry = baseRegistry();
    registry.register(tool({ name: 'copy.generate', capabilityStatus: 'CONNECTED' }));

    const createContent = listActionCards(registry).find(
      (card) => card.actionType === 'CREATE_CONTENT',
    );

    expect(createContent?.availability).toBe('LIMITED');
  });

  it('prepares a typed action and blocks unavailable capability paths', () => {
    const action = prepareTocaAction(
      {
        action_type: 'CREATE_CONTENT',
        operation: 'THE_PARTY',
        objective: 'Vender ingressos',
        mode: 'AUTO',
      },
      baseRegistry(),
      {
        createId: (() => {
          let index = 0;
          return () => `id-${++index}`;
        })(),
        now: () => '2026-09-05T02:00:00.000Z',
      },
    );

    expect(action.actionId).toBe('id-1');
    expect(action.correlationId).toBe('id-2');
    expect(action.state).toBe('BLOCKED');
    expect(action.availability).toBe('UNAVAILABLE');
    expect(action.request.inputs).toEqual({});
  });

  it('surfaces formal-approval risk only as a hint before exact Core policy resolution', () => {
    const registry = baseRegistry();
    registry.register(
      tool({
        name: 'instagram.toca_schedule.create',
        riskClass: 'WRITE_EXTERNAL',
        sideEffects: true,
      }),
    );

    const publishCard = listActionCards(registry).find(
      (card) => card.actionType === 'PUBLISH_SCHEDULE',
    );

    expect(publishCard?.availability).toBe('AVAILABLE');
    expect(publishCard?.approvalHint).toBe(true);
  });

  it('maps provider uncertainty to an explicit non-success state', () => {
    expect(actionStateFromExecutionPhase('PROVIDER_UNCERTAIN')).toBe('UNCERTAIN');
    expect(actionStateFromExecutionPhase('PROVIDER_VERIFIED')).toBe('COMPLETED');
  });

  it('creates SSE-compatible action events with correlation continuity', () => {
    const registry = baseRegistry();
    registry.register(tool({ name: 'copy.generate' }));
    const action = prepareTocaAction(
      {
        action_type: 'CREATE_CONTENT',
        operation: 'THE_PARTY',
        objective: 'Criar Story',
      },
      registry,
      {
        createId: (() => {
          let index = 0;
          return () => `action-${++index}`;
        })(),
        now: () => '2026-09-05T02:00:00.000Z',
      },
    );

    const event = createTocaActionEvent({
      action,
      phase: 'RUNNING',
      sequence: 2,
      message: 'Produção iniciada',
      createId: () => 'event-1',
      now: () => '2026-09-05T02:00:01.000Z',
    });

    expect(event.actionId).toBe(action.actionId);
    expect(event.correlationId).toBe(action.correlationId);
    expect(event.type).toBe('EXECUTION_STARTED');
    expect(event.state).toBe('RUNNING');
  });
});
