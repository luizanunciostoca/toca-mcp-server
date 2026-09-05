import { randomUUID } from 'node:crypto';
import type { ToolRegistry } from '../core/tool-registry.js';
import { ACTION_CARD_CATALOG } from './action-catalog.js';
import { resolveCapabilitySnapshot } from './capability-view.js';
import {
  tocaActionRequestSchema,
  type ActionAvailability,
  type ActionCardDefinition,
  type ActionCardSnapshot,
  type CapabilitySnapshot,
  type TocaAction,
  type TocaActionRequest,
} from './contracts.js';
import { getVideoCreationOption } from './video-creation-options.js';

const availabilityScore: Readonly<Record<ActionAvailability, number>> = {
  AVAILABLE: 4,
  LIMITED: 3,
  UNAVAILABLE: 2,
  BLOCKED: 1,
};

export function listActionCards(registry: ToolRegistry): readonly ActionCardSnapshot[] {
  return ACTION_CARD_CATALOG.map((definition) => resolveActionCard(definition, registry));
}

export function resolveActionCard(
  definition: ActionCardDefinition,
  registry: ToolRegistry,
): ActionCardSnapshot {
  const allOf = definition.requirement.allOf.map((id) => resolveCapabilitySnapshot(registry, id));
  const anyOf = definition.requirement.anyOf.map((id) => resolveCapabilitySnapshot(registry, id));
  const capabilities = deduplicateSnapshots([...allOf, ...anyOf]);

  const allOfAvailability = resolveAllOfAvailability(allOf);
  const anyOfAvailability = resolveAnyOfAvailability(anyOf);
  const availability = worstAvailability(allOfAvailability, anyOfAvailability);
  const reasons = capabilities
    .filter((capability) => capability.availability !== 'AVAILABLE')
    .map((capability) => `${capability.capabilityId}: ${capability.reason}`);

  return {
    actionType: definition.actionType,
    title: definition.title,
    description: definition.description,
    defaultMode: definition.defaultMode,
    availability,
    approvalHint: capabilities.some((capability) => capability.approvalHint),
    capabilities,
    reasons,
  };
}

export function prepareTocaAction(
  rawRequest: unknown,
  registry: ToolRegistry,
  options: {
    readonly createId?: () => string;
    readonly now?: () => string;
  } = {},
): TocaAction {
  const request = tocaActionRequestSchema.parse(rawRequest);
  validateVideoRouteSelection(request);

  const definition = ACTION_CARD_CATALOG.find(
    (candidate) => candidate.actionType === request.action_type,
  );
  if (!definition) {
    throw new Error(`ACTION_TYPE_NOT_CATALOGUED:${request.action_type}`);
  }
  const card = resolveActionCard(definition, registry);
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());
  const blocked = card.availability === 'BLOCKED' || card.availability === 'UNAVAILABLE';
  const routeReasons = videoRouteReasons(request);

  return {
    actionId: createId(),
    correlationId: createId(),
    request,
    state: blocked ? 'BLOCKED' : 'READY',
    availability: card.availability,
    approvalHint: card.approvalHint,
    reasons: blocked
      ? [...(card.reasons.length > 0 ? card.reasons : ['Required capability path is unavailable.']), ...routeReasons]
      : [...card.reasons, ...routeReasons],
    createdAt: now(),
  };
}

export function parseTocaActionRequest(input: unknown): TocaActionRequest {
  return tocaActionRequestSchema.parse(input);
}

function validateVideoRouteSelection(request: TocaActionRequest): void {
  if (request.action_type === 'CREATE_VIDEO' && !request.video_route) {
    throw new Error('VIDEO_CREATION_ROUTE_REQUIRED');
  }
  if (request.video_route) getVideoCreationOption(request.video_route);
}

function videoRouteReasons(request: TocaActionRequest): readonly string[] {
  if (!request.video_route) return [];
  const option = getVideoCreationOption(request.video_route);
  return option.restricted
    ? [
        `${option.route}: rota restrita; não pode substituir footage factual nem contornar source binding, Creative Truth, aprovação ou QA.`,
      ]
    : [`${option.route}: rota de vídeo selecionada pelo cliente para resolução governada.`];
}

function resolveAllOfAvailability(capabilities: readonly CapabilitySnapshot[]): ActionAvailability {
  if (capabilities.length === 0) return 'AVAILABLE';
  return capabilities.reduce<ActionAvailability>(
    (current, capability) => worstAvailability(current, capability.availability),
    'AVAILABLE',
  );
}

function resolveAnyOfAvailability(capabilities: readonly CapabilitySnapshot[]): ActionAvailability {
  if (capabilities.length === 0) return 'AVAILABLE';
  return capabilities.reduce<ActionAvailability>(
    (current, capability) => bestAvailability(current, capability.availability),
    'BLOCKED',
  );
}

function worstAvailability(a: ActionAvailability, b: ActionAvailability): ActionAvailability {
  return availabilityScore[a] <= availabilityScore[b] ? a : b;
}

function bestAvailability(a: ActionAvailability, b: ActionAvailability): ActionAvailability {
  return availabilityScore[a] >= availabilityScore[b] ? a : b;
}

function deduplicateSnapshots(
  capabilities: readonly CapabilitySnapshot[],
): readonly CapabilitySnapshot[] {
  const byId = new Map<string, CapabilitySnapshot>();
  for (const capability of capabilities) byId.set(capability.capabilityId, capability);
  return [...byId.values()];
}
