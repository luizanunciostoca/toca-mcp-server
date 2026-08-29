import { deriveMetaWebhookVerifyToken } from './meta-webhook-verify-token.js';

const DERIVED_VERIFY_TOKEN_ENV_KEY = 'TOCA_DERIVED_META_WEBHOOK_VERIFY_TOKEN';

export function prepareMetaWebhookRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!isTrue(env.META_WEBHOOK_ENABLED)) return env;

  const configuredKey = env.META_WEBHOOK_VERIFY_TOKEN_KEY?.trim();
  if (configuredKey) {
    const configuredValue = env[configuredKey]?.trim();
    if (!configuredValue) throw new Error('META_WEBHOOK_VERIFY_TOKEN_REFERENCE_MISSING');
    return env;
  }

  if (env.META_APP_SECRET_PROVIDER?.trim() !== 'env') {
    throw new Error('META_WEBHOOK_DERIVED_VERIFY_TOKEN_REQUIRES_ENV_APP_SECRET');
  }
  const appSecretKey = env.META_APP_SECRET_KEY?.trim();
  if (!appSecretKey) throw new Error('META_APP_SECRET_KEY_REQUIRED');
  const appSecret = env[appSecretKey]?.trim();
  if (!appSecret) throw new Error('META_APP_SECRET_REFERENCE_MISSING');

  env[DERIVED_VERIFY_TOKEN_ENV_KEY] = deriveMetaWebhookVerifyToken(appSecret);
  env.META_WEBHOOK_VERIFY_TOKEN_KEY = DERIVED_VERIFY_TOKEN_ENV_KEY;
  return env;
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}
