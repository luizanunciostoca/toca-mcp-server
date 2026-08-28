const PROVIDER = 'openai';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface OpenAiResponseBody {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly model?: unknown;
  readonly output_text?: unknown;
  readonly output?: readonly unknown[];
}

async function main(): Promise<void> {
  const apiKey = requiredEnv('OPENAI_API_KEY');
  const model = requiredEnv('AG01_OPENAI_MODEL');
  const baseUrl = (process.env.AG01_OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  const correlationId = process.env.P2_2_CORRELATION_ID?.trim() || `p2.2:${Date.now()}`;
  const sourceSha = process.env.TOCA_RELEASE_SHA?.trim() || 'unknown';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 256,
        instructions: [
          'This is a provider-readiness smoke for TOCA OS AG-01.',
          'You are advisory only. You have no authority to execute capabilities, bypass Policy, grant Approval, or call providers.',
          'Return only the requested structured object.',
        ].join(' '),
        input: 'Acknowledge the authority boundary for this read-only model provider smoke.',
        text: {
          format: {
            type: 'json_schema',
            name: 'ag01_provider_readback',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                status: { type: 'string', enum: ['READY'] },
                authority: { type: 'string', enum: ['CORE_POLICY_APPROVAL'] },
                sideEffectAuthorization: { type: 'boolean', enum: [false] },
              },
              required: ['status', 'authority', 'sideEffectAuthorization'],
            },
          },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`AG01_MODEL_PROVIDER_HTTP_ERROR:${response.status}`);
    }
    const body = (await response.json()) as OpenAiResponseBody;
    const responseId = requireString(body.id, 'AG01_MODEL_RESPONSE_ID_MISSING');
    const responseModel = requireString(body.model, 'AG01_MODEL_RESPONSE_MODEL_MISSING');
    const responseStatus = requireString(body.status, 'AG01_MODEL_RESPONSE_STATUS_MISSING');
    if (responseStatus !== 'completed') {
      throw new Error(`AG01_MODEL_RESPONSE_INCOMPLETE:${responseStatus}`);
    }
    const parsed = JSON.parse(extractOutputText(body)) as Record<string, unknown>;
    if (
      parsed.status !== 'READY' ||
      parsed.authority !== 'CORE_POLICY_APPROVAL' ||
      parsed.sideEffectAuthorization !== false
    ) {
      throw new Error('AG01_MODEL_AUTHORITY_READBACK_MISMATCH');
    }

    const evidence = {
      schemaVersion: 'toca.p2.2.ag01-model-provider-readback.v1',
      status: 'PROVIDER_VERIFIED',
      provider: PROVIDER,
      modelRequested: model,
      modelReadback: responseModel,
      responseId,
      responseStatus,
      sourceSha,
      correlationId,
      latencyMs: Date.now() - startedAt,
      authority: 'CORE_POLICY_APPROVAL',
      modelRole: 'ADVISORY_ONLY',
      sideEffectAuthorization: false,
      providerMutationExecuted: false,
      externalCapabilityExecuted: false,
      secretValueLogged: false,
      store: false,
    } as const;
    console.log(`P2_2_AG01_MODEL_READBACK_RESULT=${JSON.stringify(evidence)}`);
  } catch (error) {
    const code = normalizeError(error);
    console.error(
      `P2_2_AG01_MODEL_READBACK_FAILURE=${JSON.stringify({
        schemaVersion: 'toca.p2.2.ag01-model-provider-readback.failure.v1',
        status: 'BLOCKED',
        provider: PROVIDER,
        modelRequested: model,
        sourceSha,
        correlationId,
        error: code,
        providerMutationExecuted: false,
        externalCapabilityExecuted: false,
        secretValueLogged: false,
      })}`,
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

function extractOutputText(body: OpenAiResponseBody): string {
  if (typeof body.output_text === 'string' && body.output_text.trim()) return body.output_text;
  for (const item of body.output ?? []) {
    if (!isRecord(item)) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (part.type === 'refusal') throw new Error('AG01_MODEL_REFUSAL');
      if (part.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
        return part.text;
      }
    }
  }
  throw new Error('AG01_MODEL_STRUCTURED_OUTPUT_MISSING');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`P2_2_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'AG01_MODEL_TIMEOUT';
  if (error instanceof Error) return error.message.split('\n')[0] || error.name;
  return 'AG01_MODEL_PROVIDER_UNAVAILABLE';
}

void main();
