import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import * as z from 'zod/v4';
import { ROUTE_IDS } from '../governance/types.js';
import type { Ag01ProductionRuntime } from './production-runtime.js';

const MAX_BODY_BYTES = 1024 * 1024;
const FOLLOWUP_TICK_LIMIT = 100;
const executeSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(300).optional(),
    messageId: z.string().trim().min(1).max(300).optional(),
    idempotencyKey: z.string().trim().min(1).max(300),
    message: z.string().trim().min(1).max(100_000),
    correlationId: z.string().trim().min(1).max(300).optional(),
    causationId: z.string().trim().min(1).max(300).nullable().optional(),
    routeHint: z.enum(ROUTE_IDS).optional(),
  })
  .strict();
const resumeSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(300),
  })
  .strict();

export function createAg01HttpServer(runtime: Ag01ProductionRuntime): Server {
  return createServer((request, response) => {
    void routeRequest(runtime, request, response).catch((error: unknown) => {
      const normalized = normalizeHttpError(error);
      log('ag01.http.failed', {
        method: request.method ?? 'UNKNOWN',
        path: safePath(request.url),
        statusCode: normalized.status,
        errorCode: normalized.code,
      });
      if (!response.headersSent) writeJson(response, normalized.status, { error: normalized.code });
      else if (!response.writableEnded) response.end();
    });
  });
}

async function routeRequest(
  runtime: Ag01ProductionRuntime,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const startedAt = Date.now();

  if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
    writeJson(response, 200, {
      status: 'ok',
      service: runtime.serviceName,
      version: runtime.serviceVersion,
    });
    return;
  }

  if (method === 'GET' && url.pathname === '/readyz') {
    try {
      await runtime.readiness();
      writeJson(response, 200, {
        status: 'ready',
        service: runtime.serviceName,
        version: runtime.serviceVersion,
        runtimeCapabilityCount: runtime.runtimeCapabilityIds.length,
      });
    } catch (error) {
      log('ag01.readiness.failed', { errorCode: normalizeHttpError(error).code });
      writeJson(response, 503, {
        status: 'not_ready',
        service: runtime.serviceName,
        version: runtime.serviceVersion,
      });
    }
    return;
  }

  if (url.pathname === '/v1/orchestrator/followups/tick') {
    if (method !== 'POST') {
      response.setHeader('allow', 'POST');
      writeJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    const result = await runtime.followups.tick(FOLLOWUP_TICK_LIMIT);
    writeJson(response, 200, {
      status: 'ok',
      firedTimerCount: result.firedTimerIds.length,
      processedWorkflowCount: result.processedWorkflowIds.length,
    });
    log('ag01.followups.tick.completed', {
      firedTimerCount: result.firedTimerIds.length,
      processedWorkflowCount: result.processedWorkflowIds.length,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  if (method === 'POST' && url.pathname === '/v1/orchestrator/execute') {
    const input = executeSchema.parse(await readJsonBody(request));
    const result = await runtime.execute({
      idempotencyKey: input.idempotencyKey,
      message: input.message,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
      ...(input.routeHint ? { routeHint: input.routeHint } : {}),
    });
    response.setHeader('x-correlation-id', result.orchestration.correlationId);
    writeJson(response, statusForOrchestration(result.orchestration.status), result);
    log('ag01.request.completed', {
      operation: 'execute',
      correlationId: result.orchestration.correlationId,
      conversationId: result.orchestration.conversationId,
      runId: result.orchestration.runId,
      routeId: result.orchestration.routeId,
      status: result.orchestration.status,
      duplicate: result.orchestration.duplicate,
      modelResponseId: result.modelResponseId,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  if (method === 'POST' && url.pathname === '/v1/orchestrator/resume') {
    const input = resumeSchema.parse(await readJsonBody(request));
    const result = await runtime.resume(input.conversationId);
    response.setHeader('x-correlation-id', result.orchestration.correlationId);
    writeJson(response, statusForOrchestration(result.orchestration.status), result);
    log('ag01.request.completed', {
      operation: 'resume',
      correlationId: result.orchestration.correlationId,
      conversationId: result.orchestration.conversationId,
      runId: result.orchestration.runId,
      routeId: result.orchestration.routeId,
      status: result.orchestration.status,
      duplicate: result.orchestration.duplicate,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  writeJson(response, 404, { error: 'not_found' });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of request) {
    const chunk: unknown = rawChunk;
    const buffer =
      typeof chunk === 'string'
        ? Buffer.from(chunk, 'utf8')
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : null;
    if (!buffer) throw new HttpBoundaryError(400, 'invalid_request_body_chunk');
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpBoundaryError(413, 'request_body_too_large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new HttpBoundaryError(400, 'request_body_required');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpBoundaryError(400, 'invalid_json');
  }
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  response.end(JSON.stringify(body));
}

function statusForOrchestration(status: string): number {
  if (status === 'WAITING_APPROVAL' || status === 'HUMAN_REQUIRED') return 409;
  if (status === 'DEAD_LETTERED') return 422;
  return 200;
}

class HttpBoundaryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'HttpBoundaryError';
  }
}

function normalizeHttpError(error: unknown): { readonly status: number; readonly code: string } {
  if (error instanceof HttpBoundaryError) return error;
  if (error instanceof z.ZodError) return { status: 400, code: 'invalid_request' };
  const message = error instanceof Error ? error.message : 'AG01_RUNTIME_ERROR';
  const code = (message.split(':')[0] || 'AG01_RUNTIME_ERROR').replace(/[^A-Z0-9_.-]/gi, '_');
  if (code === 'AG01_MODEL_TIMEOUT') return { status: 504, code };
  if (code === 'AG01_MODEL_PROVIDER_UNAVAILABLE' || code === 'AG01_TOCA_OS_REGISTRY_TIMEOUT') {
    return { status: 503, code };
  }
  if (code.startsWith('AG01_MODEL_PROVIDER_HTTP_ERROR')) return { status: 503, code };
  if (
    code.includes('STRUCTURED_OUTPUT') ||
    code.includes('MODEL_ROUTE') ||
    code.includes('MODEL_AGENT') ||
    code.includes('MODEL_RISK') ||
    code.includes('MODEL_APPROVAL') ||
    code.includes('MODEL_EXPECTED_READBACK')
  ) {
    return { status: 502, code };
  }
  if (
    code.includes('REQUIRED_ARTIFACT') ||
    code.includes('SOP_ARTIFACT') ||
    code.includes('CAPABILITY_NOT_ALLOWED') ||
    code.includes('CAPABILITY_NOT_RUNTIME_BOUND') ||
    code.includes('ROUTE_NOT_AUTHORIZED')
  ) {
    return { status: 422, code };
  }
  if (code === 'AG01_HUMAN_ESCALATION') return { status: 409, code };
  return { status: 500, code };
}

function log(event: string, fields: Readonly<Record<string, unknown>>): void {
  console.log(
    JSON.stringify({
      severity: event.endsWith('.failed') ? 'ERROR' : 'INFO',
      event,
      timestamp: new Date().toISOString(),
      ...fields,
    }),
  );
}

function safePath(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl ?? '/', 'http://localhost').pathname;
  } catch {
    return '/invalid-url';
  }
}
