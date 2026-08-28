import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function insertBefore(path, needle, insertion, marker) {
  let content = read(path);
  if (content.includes(marker)) return;
  const index = content.indexOf(needle);
  if (index < 0) throw new Error(`PATCH_NEEDLE_MISSING:${path}:${marker}`);
  content = `${content.slice(0, index)}${insertion}${content.slice(index)}`;
  write(path, content);
}

function insertAfter(path, needle, insertion, marker) {
  let content = read(path);
  if (content.includes(marker)) return;
  const index = content.indexOf(needle);
  if (index < 0) throw new Error(`PATCH_NEEDLE_MISSING:${path}:${marker}`);
  const end = index + needle.length;
  content = `${content.slice(0, end)}${insertion}${content.slice(end)}`;
  write(path, content);
}

function insertIntoNamedArray(path, arrayStart, insertion, marker) {
  let content = read(path);
  if (content.includes(marker)) return;
  const start = content.indexOf(arrayStart);
  if (start < 0) throw new Error(`PATCH_ARRAY_MISSING:${path}:${arrayStart}`);
  const close = content.indexOf('\n];', start);
  if (close < 0) throw new Error(`PATCH_ARRAY_CLOSE_MISSING:${path}:${arrayStart}`);
  content = `${content.slice(0, close)}${insertion}${content.slice(close)}`;
  write(path, content);
}

insertIntoNamedArray(
  'src/registry.ts',
  'const instagramReadTools: readonly ToolDefinition[] = [',
  `\n  {\n    name: 'instagram.messaging.conversations.read',\n    version: '1.0.0',\n    provider: 'Meta/Instagram',\n    riskClass: 'READ',\n    requiredScopes: ['instagram_basic', 'instagram_manage_messages', 'pages_manage_metadata'],\n    capabilityStatus: 'IMPLEMENTED',\n    sideEffects: false,\n    idempotent: true,\n  },\n  {\n    name: 'instagram.messaging.messages.read',\n    version: '1.0.0',\n    provider: 'Meta/Instagram',\n    riskClass: 'READ',\n    requiredScopes: ['instagram_basic', 'instagram_manage_messages', 'pages_manage_metadata'],\n    capabilityStatus: 'IMPLEMENTED',\n    sideEffects: false,\n    idempotent: true,\n  },`,
  "name: 'instagram.messaging.conversations.read'",
);

insertAfter(
  'src/mcp/runtime-capability-resolver.ts',
  "import type { InstagramHistoryProvider } from '../providers/instagram/instagram-history-provider.js';",
  "\nimport type { InstagramMessagingReadProvider } from '../providers/instagram/instagram-messaging-read-provider.js';",
  'InstagramMessagingReadProvider',
);

insertBefore(
  'src/mcp/runtime-capability-resolver.ts',
  'const adAccountSchema = z.object({',
  `const instagramConversationListSchema = z.object({\n  limit: z.number().int().min(1).max(100).default(50),\n  after: z.string().min(1).optional(),\n});\nconst instagramMessageListSchema = z.object({\n  conversationId: z.string().min(1),\n  limit: z.number().int().min(1).max(20).default(20),\n});\n`,
  'const instagramConversationListSchema',
);

insertAfter(
  'src/mcp/runtime-capability-resolver.ts',
  '  readonly instagramHistory?: InstagramHistoryProvider;',
  '\n  readonly instagramMessagingRead?: InstagramMessagingReadProvider;',
  'readonly instagramMessagingRead?',
);

insertBefore(
  'src/mcp/runtime-capability-resolver.ts',
  "    case 'meta_ads.accounts.list':",
  `    case 'instagram.messaging.conversations.read':\n      return services.instagramMessagingRead\n        ? binding(instagramConversationListSchema, (input) =>\n            services.instagramMessagingRead!.listConversations(input),\n          )\n        : undefined;\n    case 'instagram.messaging.messages.read':\n      return services.instagramMessagingRead\n        ? binding(instagramMessageListSchema, (input) =>\n            services.instagramMessagingRead!.listMessages(input),\n          )\n        : undefined;\n`,
  "case 'instagram.messaging.conversations.read'",
);

insertAfter(
  'src/server.ts',
  "import { InstagramHistoryProvider } from './providers/instagram/instagram-history-provider.js';",
  "\nimport { InstagramMessagingReadProvider } from './providers/instagram/instagram-messaging-read-provider.js';",
  'InstagramMessagingReadProvider',
);

insertBefore(
  'src/server.ts',
  '\n  let instagramPublication: InstagramCorePublicationRuntime | undefined;',
  `\n  const instagramMessagingRead =\n    config.INSTAGRAM_READ_ENABLED &&\n    config.INSTAGRAM_BUSINESS_ACCOUNT_ID &&\n    config.META_ACCESS_TOKEN_ENV_KEY\n      ? new InstagramMessagingReadProvider(createMetaClient(), config.INSTAGRAM_BUSINESS_ACCOUNT_ID)\n      : undefined;\n`,
  'const instagramMessagingRead =',
);

insertAfter(
  'src/server.ts',
  '    ...(instagramHistory ? { instagramHistory } : {}),',
  '\n    ...(instagramMessagingRead ? { instagramMessagingRead } : {}),',
  '...(instagramMessagingRead ? { instagramMessagingRead } : {}),',
);

insertBefore(
  'src/server.ts',
  "      'instagram.toca_schedule.create',",
  `      ...(config.INSTAGRAM_READ_ENABLED &&\n      config.META_ACCESS_TOKEN_ENV_KEY &&\n      config.INSTAGRAM_BUSINESS_ACCOUNT_ID\n        ? ['instagram.messaging.conversations.read', 'instagram.messaging.messages.read']\n        : []),\n`,
  "'instagram.messaging.conversations.read', 'instagram.messaging.messages.read'",
);

console.log('Instagram messaging read-only MCP patches applied.');
