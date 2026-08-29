import { createHmac } from 'node:crypto';

const VERIFY_TOKEN_CONTEXT = 'TOCA_META_WEBHOOK_VERIFY_TOKEN_V1';

export function deriveMetaWebhookVerifyToken(appSecret: string): string {
  const secret = appSecret.trim();
  if (!secret) throw new Error('META_APP_SECRET_REQUIRED_FOR_DERIVED_VERIFY_TOKEN');
  return createHmac('sha256', secret).update(VERIFY_TOKEN_CONTEXT, 'utf8').digest('hex');
}
