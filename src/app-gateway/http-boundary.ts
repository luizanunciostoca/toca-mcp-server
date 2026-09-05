import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import type { ToolRegistry } from '../core/tool-registry.js';
import {
  actionModeSchema,
  actionTypeSchema,
  videoCreationRouteSchema,
  type ActionCardSnapshot,
  type TocaAction,
  type VideoCreationOptionDefinition,
} from './contracts.js';
import { listActionCards, prepareTocaAction } from './action-service.js';
import { listVideoCreationOptions } from './video-creation-options.js';

const API_PREFIX = '/api/v1';
const MAX_ACTION_BODY_BYTES = 128 * 1024;
const MAX_SESSION_SUBJECT_LENGTH = 512;
const MAX_SESSION_TENANT_LENGTH = 160;
const MAX_SESSION_ROLE_LENGTH = 120;
const MAX_SESSION_ROLES = 50;

const appGatewayCreateActionSchema = z
  .object({
    action_type: actionTypeSchema,
    operation: z.string().trim().min(1).max(120),
    objective: z.string().trim().min(1).max(800),
    mode: actionModeSchema.default('AUTO'),
    video_route: videoCreationRouteSchema.optional(),
    payload: z.record(z.string(), z.unknown()).default({}),
    client_request_id: z.string().trim().min(1).max(200),
    client_context: z
      .object({
        app_version: z.string().trim().min(1).max(40).optional(),
        locale: z.string().trim().min(1).max(32).optional(),
        timezone: z.string().trim().min(1).max(80).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export interface AppGatewayPrincipal {
  readonly subject: string;
  readonly tenantId?: string;
  readonly roles?: readonly string[];
}

export type AppGatewayAuthorize = (
  request: IncomingMessage,
) => Promise<AppGatewayPrincipal | undefined>;

export interface AppGatewayHttpOptions {
  readonly registry: ToolRegistry;
  readonly authorize?: AppGatewayAuthorize;
  readonly enabled?: boolean;
  readonly onError?: (error: unknown) => void;
  readonly createId?: () => string;
  readonly now?: () => string;
}

export type AppGatewayHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

export function createAppGatewayHttpHandler(options: AppGatewayHttpOptions): AppGatewayHttpHandler {
  return async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (!url.pathname.startsWith(`${API_PREFIX}/`) && url.pathname !== API_PREFIX) return false;
    if (options.enabled === false || !options.authorize) return false;

    const principal = await options.authorize(request);
    if (!principal?.subject.trim()) {
      sendJson(response, 401, { error: 'UNAUTHORIZED' });
      return true;
    }

    const method = request.method ?? 'GET';

    if (url.pathname === `${API_PREFIX}/session`) {
      if (method !== 'GET') return methodNotAllowed(response);
      sendJson(response, 200, {
        api_version: 'v1',
        session: serializeSessionPrincipal(principal),
      });
      return true;
    }

    if (url.pathname === `${API_PREFIX}/capabilities`) {
      if (method !== 'GET') return methodNotAllowed(response);
      sendJson(response, 200, {
        api_version: 'v1',
        actions: listActionCards(options.registry).map(serializeActionCard),
      });
      return true;
    }

    if (url.pathname === `${API_PREFIX}/video-options`) {
      if (method !== 'GET') return methodNotAllowed(response);
      sendJson(response, 200, {
        api_version: 'v1',
        video_options: listVideoCreationOptions().map(serializeVideoOption),
      });
      return true;
    }

    if (url.pathname === `${API_PREFIX}/actions`) {
      if (method !== 'POST') return methodNotAllowed(response);
      await handlePrepareAction(request, response, options);
      return true;
    }

    sendJson(response, 404, { error: 'NOT_FOUND' });
    return true;
  };
}

export function createAppGatewayHttpServer(options: AppGatewayHttpOptions): Server {
  const handler = createAppGatewayHttpHandler(options);
  return createServer((request, response) => {
    void handler(request, response)
      .then((handled) => {
        if (!handled && !response.writableEnded) sendJson(response, 404, { error: 'NOT_FOUND' });
      })
      .catch((error: unknown) => {
        options.onError?.(error);
        if (!response.headersSent) sendJson(response, 500, { error: 'APP_GATEWAY_INTERNAL_ERROR' });
        else if (!response.writableEnded) response.end();
      });
  });
}

async function handlePrepareAction(
  request: IncomingMessage,
  response: ServerResponse,
  options: AppGatewayHttpOptions,
): Promise<void> {
  try {
    const body = appGatewayCreateActionSchema.parse(
      JSON.parse((await readBody(request, MAX_ACTION_BODY_BYTES)).toString('utf8')) as unknown,
    );
    const action = prepareTocaAction(
      {
        action_type: body.action_type,
        operation: body.operation,
        objective: body.objective,
        mode: body.mode,
        ...(body.video_route ? { video_route: body.video_route } : {}),
        inputs: body.payload,
        ...(body.client_context ? { client_context: body.client_context } : {}),
      },
      options.registry,
      {
        ...(options.createId ? { createId: options.createId } : {}),
        ...(options.now ? { now: options.now } : {}),
      },
    );

    sendJson(response, 201, {
      api_version: 'v1',
      client_request_id: body.client_request_id,
      action: serializeAction(action),
    });
  } catch (error) {
    const code = safeActionError(error);
    sendJson(response, code.status, { error: code.error });
  }
}

function serializeSessionPrincipal(principal: AppGatewayPrincipal): Record<string, unknown> {
  const subject = principal.subject.trim().slice(0, MAX_SESSION_SUBJECT_LENGTH);
  const tenantId = principal.tenantId?.trim().slice(0, MAX_SESSION_TENANT_LENGTH);
  const roles = [...new Set(principal.roles ?? [])]
    .map((role) => role.trim())
    .filter(Boolean)
    .slice(0, MAX_SESSION_ROLES)
    .map((role) => role.slice(0, MAX_SESSION_ROLE_LENGTH));

  return {
    subject,
    ...(tenantId ? { tenant_id: tenantId } : {}),
    roles,
    authorization_source: 'SERVER_PRINCIPAL_MAPPER',
    capability_authority: 'TOCA_CORE_RUNTIME',
    execution_boundary: 'PREPARE_ONLY',
  };
}

function serializeActionCard(card: ActionCardSnapshot): Record<string, unknown> {
  return {
    action_type: card.actionType,
    title: card.title,
    description: card.description,
    default_mode: card.defaultMode,
    availability: card.availability,
    approval_hint: card.approvalHint,
    reasons: card.reasons,
  };
}

function serializeVideoOption(option: VideoCreationOptionDefinition): Record<string, unknown> {
  return {
    route: option.route,
    order: option.manualOrder,
    title: option.title,
    description: option.description,
    availability: option.availabilityLabel,
    source_binding: option.sourceBinding,
    generative: option.generative,
    restricted: option.restricted,
    best_use: option.bestUse,
    drift_risk: option.driftRisk,
    requires_coverage_evidence: option.requiresCoverageEvidence,
  };
}

function serializeAction(action: TocaAction): Record<string, unknown> {
  return {
    action_id: action.actionId,
    correlation_id: action.correlationId,
    state: action.state,
    availability: action.availability,
    approval_hint: action.approvalHint,
    reasons: action.reasons,
    created_at: action.createdAt,
    request: {
      action_type: action.request.action_type,
      operation: action.request.operation,
      objective: action.request.objective,
      mode: action.request.mode,
      ...(action.request.video_route ? { video_route: action.request.video_route } : {}),
    },
    ...(action.approvalPreview
      ? {
          approval_preview: {
            approval_id: action.approvalPreview.approval_id,
            capability_id: action.approvalPreview.capability_id,
            route_id: action.approvalPreview.route_id,
            target_account: action.approvalPreview.target_account,
            descriptor_sha256: action.approvalPreview.descriptor_sha256,
            ...(action.approvalPreview.financial_ceiling !== undefined
              ? { financial_ceiling: action.approvalPreview.financial_ceiling }
              : {}),
            expires_at: action.approvalPreview.expires_at,
            status: action.approvalPreview.status,
          },
        }
      : {}),
  };
}

async function readBody(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > maximumBytes) throw new AppGatewayBodyTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function safeActionError(error: unknown): { status: number; error: string } {
  if (error instanceof AppGatewayBodyTooLargeError) return { status: 413, error: 'BODY_TOO_LARGE' };
  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    return { status: 400, error: 'INVALID_ACTION_REQUEST' };
  }
  if (error instanceof Error) {
    if (error.message === 'VIDEO_CREATION_ROUTE_REQUIRED') {
      return { status: 400, error: 'VIDEO_CREATION_ROUTE_REQUIRED' };
    }
    if (error.message.startsWith('VIDEO_CREATION_ROUTE_NOT_CATALOGUED:')) {
      return { status: 400, error: 'VIDEO_CREATION_ROUTE_NOT_CATALOGUED' };
    }
  }
  return { status: 500, error: 'APP_GATEWAY_PREPARE_FAILED' };
}

function methodNotAllowed(response: ServerResponse): true {
  sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
  return true;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

class AppGatewayBodyTooLargeError extends Error {
  constructor() {
    super('APP_GATEWAY_BODY_TOO_LARGE');
  }
}
