import type { SecretResolver } from '../../core/secrets.js';
import type { ProviderBindingRef } from '../../omnichannel/contracts.js';
import { validateSendGridConfig, type SendGridConfig } from './email-provider.js';

export interface SendGridRuntimeConfigResult {
  readonly enabled: boolean;
  readonly config: SendGridConfig | null;
  readonly expectedDkimRecords: readonly { readonly host: string; readonly target: string }[];
  readonly expectedSpfInclude: string;
}

export async function loadSendGridRuntimeConfig(input: {
  readonly env?: NodeJS.ProcessEnv;
  readonly secretResolver: SecretResolver;
}): Promise<SendGridRuntimeConfigResult> {
  const env = input.env ?? process.env;
  const enabled = parseBoolean(env.EMAIL_SENDGRID_ENABLED, false, 'EMAIL_SENDGRID_ENABLED_INVALID');
  const expectedDkimRecords = parseDkimRecords(env.EMAIL_SENDGRID_DKIM_RECORDS_JSON ?? '[]');
  const expectedSpfInclude = env.EMAIL_SENDGRID_SPF_INCLUDE?.trim() || 'sendgrid.net';
  if (!enabled) {
    return { enabled: false, config: null, expectedDkimRecords, expectedSpfInclude };
  }

  const secretProvider = requiredEnv(
    env,
    'EMAIL_SENDGRID_API_KEY_SECRET_PROVIDER',
    'EMAIL_SENDGRID_SECRET_PROVIDER_REQUIRED',
  );
  const secretKey = requiredEnv(
    env,
    'EMAIL_SENDGRID_API_KEY_SECRET_KEY',
    'EMAIL_SENDGRID_SECRET_KEY_REQUIRED',
  );
  const apiKey = await input.secretResolver.resolve({ provider: secretProvider, key: secretKey });
  const bindingState = parseBindingState(
    requiredEnv(env, 'EMAIL_SENDGRID_BINDING_STATE', 'EMAIL_SENDGRID_BINDING_STATE_REQUIRED'),
  );
  const config: SendGridConfig = {
    apiKey,
    apiBaseUrl: env.EMAIL_SENDGRID_API_BASE_URL?.trim() || 'https://api.sendgrid.com',
    sendingDomain: requiredEnv(
      env,
      'EMAIL_SENDGRID_SENDING_DOMAIN',
      'EMAIL_SENDGRID_SENDING_DOMAIN_REQUIRED',
    ),
    fromEmail: requiredEnv(env, 'EMAIL_SENDGRID_FROM_EMAIL', 'EMAIL_SENDGRID_FROM_EMAIL_REQUIRED'),
    fromName: requiredEnv(env, 'EMAIL_SENDGRID_FROM_NAME', 'EMAIL_SENDGRID_FROM_NAME_REQUIRED'),
    replyToEmail: nullableEnv(env.EMAIL_SENDGRID_REPLY_TO_EMAIL),
    bindingId: requiredEnv(env, 'EMAIL_SENDGRID_BINDING_ID', 'EMAIL_SENDGRID_BINDING_ID_REQUIRED'),
    bindingState,
    eventWebhookPublicKeyPem: nullableEnv(env.EMAIL_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY_PEM),
    inboundParsePublicKeyPem: nullableEnv(env.EMAIL_SENDGRID_INBOUND_PARSE_PUBLIC_KEY_PEM),
    emailActivityReadbackEnabled: parseBoolean(
      env.EMAIL_SENDGRID_EMAIL_ACTIVITY_READBACK_ENABLED,
      false,
      'EMAIL_SENDGRID_EMAIL_ACTIVITY_READBACK_ENABLED_INVALID',
    ),
  };
  validateSendGridConfig(config);
  return { enabled: true, config, expectedDkimRecords, expectedSpfInclude };
}

function parseBindingState(value: string): ProviderBindingRef['state'] {
  const allowed: readonly ProviderBindingRef['state'][] = [
    'UNBOUND',
    'CONNECTED',
    'INTEGRATION_VALIDATED',
    'PRODUCTION_VALIDATED',
  ];
  if (!allowed.includes(value as ProviderBindingRef['state'])) {
    throw new Error('EMAIL_SENDGRID_BINDING_STATE_INVALID');
  }
  return value as ProviderBindingRef['state'];
}

function parseDkimRecords(
  value: string,
): readonly { readonly host: string; readonly target: string }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('EMAIL_SENDGRID_DKIM_RECORDS_JSON_INVALID');
  }
  if (!Array.isArray(parsed)) throw new Error('EMAIL_SENDGRID_DKIM_RECORDS_JSON_INVALID');
  return parsed.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('EMAIL_SENDGRID_DKIM_RECORD_INVALID');
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.host !== 'string' || !record.host.trim()) {
      throw new Error('EMAIL_SENDGRID_DKIM_HOST_REQUIRED');
    }
    if (typeof record.target !== 'string' || !record.target.trim()) {
      throw new Error('EMAIL_SENDGRID_DKIM_TARGET_REQUIRED');
    }
    return { host: record.host.trim(), target: record.target.trim() };
  });
}

function parseBoolean(value: string | undefined, fallback: boolean, code: string): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(code);
}

function nullableEnv(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string, code: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(code);
  return value;
}
