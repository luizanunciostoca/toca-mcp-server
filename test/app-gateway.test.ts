import { describe, expect, it } from 'vitest';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import {
  actionStateFromExecutionPhase,
  attachApprovalPreview,
  capabilityStatusToAvailability,
  createTocaActionEvent,
  listActionCards,
  listVideoCreationOptions,
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

  it('preserves descriptor-bound approval preview fields supplied by the Core', () => {
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
          return () => `approval-${++index}`;
        })(),
        now: () => '2026-09-05T02:00:00.000Z',
      },
    );
    const descriptor = 'a'.repeat(64);

    const withApproval = attachApprovalPreview(action, {
      approval_id: 'APR-001',
      capability_id: 'instagram.publication.publish',
      route_id: 'R20',
      target_account: 'instagram:toca',
      descriptor_sha256: descriptor,
      expires_at: '2026-09-05T03:00:00-03:00',
      status: 'REQUESTED',
    });

    expect(withApproval.approvalPreview).toMatchObject({
      approval_id: 'APR-001',
      route_id: 'R20',
      target_account: 'instagram:toca',
      descriptor_sha256: descriptor,
    });
    expect(() =>
      attachApprovalPreview(action, {
        approval_id: 'APR-INVALID',
        capability_id: 'instagram.publication.publish',
        route_id: 'R20',
        target_account: 'instagram:toca',
        descriptor_sha256: 'not-a-sha256',
        expires_at: '2026-09-05T03:00:00-03:00',
        status: 'REQUESTED',
      }),
    ).toThrow();
  });

  it('exposes the ten governed video creation options from the visual manual', () => {
    const options = listVideoCreationOptions();

    expect(options).toHaveLength(10);
    expect(options.map((option) => option.manualOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(options.at(-1)).toMatchObject({
      route: 'SYNTHETIC_TEXT_TO_VIDEO_RESTRICTED',
      restricted: true,
      driftRisk: 'ALTO',
    });
  });

  it('requires an explicit route for video creation requests', () => {
    const registry = baseRegistry();
    registry.register(tool({ name: 'video.select_assets' }));

    expect(() =>
      prepareTocaAction(
        {
          action_type: 'CREATE_VIDEO',
          operation: 'THE_PARTY',
          objective: 'Criar Reel hero',
        },
        registry,
      ),
    ).toThrow('VIDEO_CREATION_ROUTE_REQUIRED');
  });

  it('prepares video creation with the selected governed route', () => {
    const registry = baseRegistry();
    registry.register(tool({ name: 'video.select_assets' }));

    const action = prepareTocaAction(
      {
        action_type: 'CREATE_VIDEO',
        operation: 'THE_PARTY',
        objective: 'Criar Reel hero',
        video_route: 'REAL_FOOTAGE_FILM',
      },
      registry,
      {
        createId: (() => {
          let index = 0;
          return () => `video-${++index}`;
        })(),
        now: () => '2026-09-05T02:00:00.000Z',
      },
    );

    expect(action.state).toBe('READY');
    expect(action.request.video_route).toBe('REAL_FOOTAGE_FILM');
    expect(action.reasons.join(' ')).toContain('REAL_FOOTAGE_FILM');
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
