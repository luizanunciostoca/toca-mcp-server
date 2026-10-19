import * as z from 'zod/v4';
import {
  createReadonlyMcpAuth,
  readonlyPrincipalSchema,
  type ReadonlyMcpAuth,
} from './readonly-auth.js';

/** Opt-in configuration only. No deployment, credentials, trust defaults, or provider composition. */
export function createReadonlyMcpAuthFromEnv(env: NodeJS.ProcessEnv): ReadonlyMcpAuth | undefined {
  const enabled = env.MCP_READONLY_AUTH_ENABLED;
  if (enabled === undefined || enabled === 'false') return undefined;
  if (enabled !== 'true') throw new Error('MCP_READONLY_CONFIGURATION_INVALID');
  const required = (key: string): string => {
    const value = env[key];
    if (!value || value.trim() !== value) throw new Error('MCP_READONLY_CONFIGURATION_INVALID');
    return value;
  };
  return createReadonlyMcpAuth({
    resourceUrl: required('MCP_READONLY_RESOURCE_URL'),
    issuer: required('MCP_READONLY_OIDC_ISSUER'),
    audience: required('MCP_READONLY_OIDC_AUDIENCE'),
    jwksUri: required('MCP_READONLY_OIDC_JWKS_URI'),
    principals: z
      .array(readonlyPrincipalSchema)
      .min(1)
      .parse(JSON.parse(required('MCP_READONLY_PRINCIPALS_JSON'))),
  });
}
