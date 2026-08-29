import { describe, expect, it } from 'vitest';
import { deriveMetaWebhookVerifyToken } from '../src/providers/meta/meta-webhook-verify-token.js';
import { prepareMetaWebhookRuntimeEnv } from '../src/providers/meta/meta-webhook-runtime-env.js';

describe('prepareMetaWebhookRuntimeEnv', () => {
  it('derives an in-memory verify token from the referenced app secret', () => {
    const env: NodeJS.ProcessEnv = {
      META_WEBHOOK_ENABLED: 'true',
      META_APP_SECRET_PROVIDER: 'env',
      META_APP_SECRET_KEY: 'META_APP_SECRET',
      META_APP_SECRET: 'app-secret-value',
    };

    prepareMetaWebhookRuntimeEnv(env);

    expect(env.META_WEBHOOK_VERIFY_TOKEN_KEY).toBe('TOCA_DERIVED_META_WEBHOOK_VERIFY_TOKEN');
    expect(env.TOCA_DERIVED_META_WEBHOOK_VERIFY_TOKEN).toBe(
      deriveMetaWebhookVerifyToken('app-secret-value'),
    );
    expect(env.TOCA_DERIVED_META_WEBHOOK_VERIFY_TOKEN).not.toBe('app-secret-value');
  });

  it('preserves an explicitly configured verify token reference', () => {
    const env: NodeJS.ProcessEnv = {
      META_WEBHOOK_ENABLED: 'true',
      META_WEBHOOK_VERIFY_TOKEN_KEY: 'EXISTING_VERIFY_TOKEN',
      EXISTING_VERIFY_TOKEN: 'existing-token',
    };

    prepareMetaWebhookRuntimeEnv(env);

    expect(env.META_WEBHOOK_VERIFY_TOKEN_KEY).toBe('EXISTING_VERIFY_TOKEN');
    expect(env.EXISTING_VERIFY_TOKEN).toBe('existing-token');
    expect(env.TOCA_DERIVED_META_WEBHOOK_VERIFY_TOKEN).toBeUndefined();
  });

  it('fails closed when webhook is enabled but the app secret cannot be resolved', () => {
    const env: NodeJS.ProcessEnv = {
      META_WEBHOOK_ENABLED: 'true',
      META_APP_SECRET_PROVIDER: 'env',
      META_APP_SECRET_KEY: 'META_APP_SECRET',
    };

    expect(() => prepareMetaWebhookRuntimeEnv(env)).toThrow('META_APP_SECRET_REFERENCE_MISSING');
  });

  it('does nothing when the webhook is disabled', () => {
    const env: NodeJS.ProcessEnv = { META_WEBHOOK_ENABLED: 'false' };
    expect(prepareMetaWebhookRuntimeEnv(env)).toBe(env);
    expect(env.META_WEBHOOK_VERIFY_TOKEN_KEY).toBeUndefined();
  });
});
