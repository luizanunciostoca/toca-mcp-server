import { prepareMetaWebhookRuntimeEnv } from './providers/meta/meta-webhook-runtime-env.js';

prepareMetaWebhookRuntimeEnv(process.env);
await import('./http.js');
