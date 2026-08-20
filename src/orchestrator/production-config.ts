import * as z from 'zod/v4';
import {
  AUTHORIZATION_ROLES,
  type AuthorizationRole,
} from '../core/identity.js';
import { isRouteId, type RouteId } from '../governance/types.js';

const positiveInteger = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().trim().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  AG01_HOST: z.string().trim().min(1).optional(),
  AG01_OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  AG01_OPENAI_API_KEY_ENV_KEY: z.string().trim().min(1),
  AG01_OPENAI_MODEL: z.string().trim().min(1),
  AG01_OPENAI_TIMEOUT_MS: positiveInteger(20_000),
  AG01_OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AG01_OPENAI_MAX_OUTPUT_TOKENS: positiveInteger(4096),
  AG01_TOCA_OS_ROUTING_SPREADSHEET_ID: z.string().trim().min(1),
  AG01_TOCA_OS_CANONICAL_RESOURCES_SPREADSHEET_ID: z.string().trim().min(1),
  AG01_GOOGLE_OAUTH_CLIENT_ID_ENV_KEY: z.string().trim().min(1),
  AG01_GOOGLE_OAUTH_CLIENT_SECRET_ENV_KEY: z.string().trim().min(1),
  AG01_GOOGLE_OAUTH_REFRESH_TOKEN_ENV_KEY: z.string().trim().min(1),
  AG01_GOOGLE_OAUTH_TOKEN_ENDPOINT: z.string().url().default('https://oauth2.googleapis.com/token'),
  AG01_REGISTRY_CACHE_TTL_MS: positiveInteger(60_000),
  AG01_REGISTRY_TIMEOUT_MS: positiveInteger(10_000),
  AG01_AUTHORIZATION_ROLES: z.string().default('READER'),
  AG01_ALLOWED_ROUTE_IDS: z.string().default(''),
  AG01_ALLOWED_CAPABILITY_IDS: z.string().default(''),
  AG01_ALLOWED_TARGET_ACCOUNTS: z.string().default(''),
  AG01_SERVICE_PRINCIPAL_ID: z.string().trim().min(1).optional(),
  TOCA_DEFAULT_TENANT_ID: z.string().trim().min(1).default('toca'),
  TOCA_DEFAULT_WORKSPACE_ID: z.string().trim().min(1).optional(),
  TOCA_DEFAULT_ORGANIZATION_ID: z.string().trim().min(1).optional(),
});

export interface Ag01ProductionConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly databaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly openAiBaseUrl: string;
  readonly openAiApiKeyEnvKey: string;
  readonly openAiModel: string;
  readonly openAiTimeoutMs: number;
  readonly openAiMaxRetries: number;
  readonly openAiMaxOutputTokens: number;
  readonly routingSpreadsheetId: string;
  readonly canonicalResourcesSpreadsheetId: string;
  readonly googleOAuthClientIdEnvKey: string;
  readonly googleOAuthClientSecretEnvKey: string;
  readonly googleOAuthRefreshTokenEnvKey: string;
  readonly googleOAuthTokenEndpoint: string;
  readonly registryCacheTtlMs: number;
  readonly registryTimeoutMs: number;
  readonly authorizationRoles: readonly AuthorizationRole[];
  readonly allowedRouteIds: readonly RouteId[];
  readonly allowedCapabilityIds: readonly string[];
  readonly allowedTargetAccounts: readonly string[];
  readonly servicePrincipalId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

export function loadAg01ProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
): Ag01ProductionConfig {
  const value = schema.parse(env);
  requireReferencedSecret(env, value.AG01_OPENAI_API_KEY_ENV_KEY, 'AG01_OPENAI_API_KEY_ENV_KEY');
  requireReferencedSecret(
    env,
    value.AG01_GOOGLE_OAUTH_CLIENT_ID_ENV_KEY,
    'AG01_GOOGLE_OAUTH_CLIENT_ID_ENV_KEY',
  );
  requireReferencedSecret(
    env,
    value.AG01_GOOGLE_OAUTH_CLIENT_SECRET_ENV_KEY,
    'AG01_GOOGLE_OAUTH_CLIENT_SECRET_ENV_KEY',
  );
  requireReferencedSecret(
    env,
    value.AG01_GOOGLE_OAUTH_REFRESH_TOKEN_ENV_KEY,
    'AG01_GOOGLE_OAUTH_REFRESH_TOKEN_ENV_KEY',
  );

  const authorizationRoles = parseRoles(value.AG01_AUTHORIZATION_ROLES);
  const allowedRouteIds = parseRoutes(value.AG01_ALLOWED_ROUTE_IDS);
  const allowedCapabilityIds = csv(value.AG01_ALLOWED_CAPABILITY_IDS);
  const allowedTargetAccounts = csv(value.AG01_ALLOWED_TARGET_ACCOUNTS);
  const tenantId = value.TOCA_DEFAULT_TENANT_ID;

  return {
    nodeEnv: value.NODE_ENV,
    databaseUrl: value.DATABASE_URL,
    host:
      value.AG01_HOST ?? (value.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
    port: value.PORT,
    openAiBaseUrl: value.AG01_OPENAI_BASE_URL.replace(/\/$/, ''),
    openAiApiKeyEnvKey: value.AG01_OPENAI_API_KEY_ENV_KEY,
    openAiModel: value.AG01_OPENAI_MODEL,
    openAiTimeoutMs: value.AG01_OPENAI_TIMEOUT_MS,
    openAiMaxRetries: value.AG01_OPENAI_MAX_RETRIES,
    openAiMaxOutputTokens: value.AG01_OPENAI_MAX_OUTPUT_TOKENS,
    routingSpreadsheetId: value.AG01_TOCA_OS_ROUTING_SPREADSHEET_ID,
    canonicalResourcesSpreadsheetId: value.AG01_TOCA_OS_CANONICAL_RESOURCES_SPREADSHEET_ID,
    googleOAuthClientIdEnvKey: value.AG01_GOOGLE_OAUTH_CLIENT_ID_ENV_KEY,
    googleOAuthClientSecretEnvKey: value.AG01_GOOGLE_OAUTH_CLIENT_SECRET_ENV_KEY,
    googleOAuthRefreshTokenEnvKey: value.AG01_GOOGLE_OAUTH_REFRESH_TOKEN_ENV_KEY,
    googleOAuthTokenEndpoint: value.AG01_GOOGLE_OAUTH_TOKEN_ENDPOINT,
    registryCacheTtlMs: value.AG01_REGISTRY_CACHE_TTL_MS,
    registryTimeoutMs: value.AG01_REGISTRY_TIMEOUT_MS,
    authorizationRoles,
    allowedRouteIds,
    allowedCapabilityIds,
    allowedTargetAccounts,
    servicePrincipalId:
      value.AG01_SERVICE_PRINCIPAL_ID ??
      (env.K_SERVICE?.trim() ? `cloud-run-service:${env.K_SERVICE.trim()}` : 'ag01-local-runtime'),
    tenantId,
    workspaceId: value.TOCA_DEFAULT_WORKSPACE_ID ?? tenantId,
    organizationId: value.TOCA_DEFAULT_ORGANIZATION_ID ?? tenantId,
  };
}

function parseRoles(raw: string): readonly AuthorizationRole[] {
  const roles = csv(raw);
  if (roles.length === 0) throw new Error('AG01_AUTHORIZATION_ROLE_REQUIRED');
  for (const role of roles) {
    if (!(AUTHORIZATION_ROLES as readonly string[]).includes(role)) {
      throw new Error(`AG01_AUTHORIZATION_ROLE_INVALID:${role}`);
    }
  }
  return [...new Set(roles)] as AuthorizationRole[];
}

function parseRoutes(raw: string): readonly RouteId[] {
  const routes = csv(raw);
  for (const route of routes) {
    if (!isRouteId(route)) throw new Error(`AG01_ALLOWED_ROUTE_INVALID:${route}`);
  }
  return [...new Set(routes)] as RouteId[];
}

function csv(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function requireReferencedSecret(
  env: NodeJS.ProcessEnv,
  key: string,
  source: string,
): void {
  if (!env[key]?.trim()) {
    throw new Error(`Missing environment secret referenced by ${source}: ${key}`);
  }
}
