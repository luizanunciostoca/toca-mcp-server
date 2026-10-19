import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthInfo } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  createOidcBearerVerifier,
  type OidcBearerVerifierOptions,
} from '../app-gateway/oidc-verifier.js';
import { assertExecutionIdentity, type ExecutionIdentity } from '../core/identity.js';

export const readonlyPrincipalSchema = z
  .object({
    subject: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => value.trim() === value),
    tenantId: z
      .string()
      .min(1)
      .refine((value) => value.trim() === value),
    workspaceId: z
      .string()
      .min(1)
      .refine((value) => value.trim() === value),
    organizationId: z
      .string()
      .min(1)
      .refine((value) => value.trim() === value),
  })
  .strict();

export interface ReadonlyAuthOptions extends OidcBearerVerifierOptions {
  readonly resourceUrl: string;
  readonly principals: readonly z.infer<typeof readonlyPrincipalSchema>[];
}

export interface ReadonlyMcpAuth {
  readonly resourceMetadataUrl: string;
  readonly resourceMetadata: {
    readonly resource: string;
    readonly authorization_servers: readonly string[];
    readonly scopes_supported: readonly string[];
    readonly bearer_methods_supported: readonly string[];
  };
  authenticate(request: IncomingMessage): Promise<AuthInfo>;
  resolveIdentity(authInfo: AuthInfo | undefined): ExecutionIdentity;
}

export function createReadonlyMcpAuth(options: ReadonlyAuthOptions): ReadonlyMcpAuth {
  // Configuration, never request Host/Forwarded headers, defines the trust boundary.
  const resource = canonicalHttpsUrl(options.resourceUrl);
  const issuer = canonicalHttpsUrl(options.issuer);
  if (resource.pathname !== '/mcp' || options.audience !== options.resourceUrl) {
    throw new Error('MCP_READONLY_CONFIGURATION_INVALID');
  }
  const resourceMetadataUrl = `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
  const resourceMetadata = Object.freeze({
    resource: resource.href,
    authorization_servers: Object.freeze([issuer.href]),
    scopes_supported: Object.freeze(['toca:read']),
    bearer_methods_supported: Object.freeze(['header']),
  });
  const principals = z.array(readonlyPrincipalSchema).min(1).parse(options.principals);
  const mappings = new Map(principals.map((principal) => [principal.subject, principal]));
  if (mappings.size !== principals.length) throw new Error('MCP_READONLY_MAPPING_AMBIGUOUS');
  const verifier = createOidcBearerVerifier(options);
  const now = options.nowEpochSeconds ?? (() => Date.now() / 1000);
  // Only objects created by this verifier instance may cross into Core identity.
  const identities = new WeakMap<AuthInfo, ExecutionIdentity>();
  function resolveIdentity(authInfo: AuthInfo | undefined): ExecutionIdentity {
    const identity = authInfo && identities.get(authInfo);
    if (!identity) throw new Error('MCP_READONLY_AUTH_REQUIRED');
    assertExecutionIdentity(identity, new Date(now() * 1000).toISOString());
    return identity;
  }
  return {
    resourceMetadataUrl,
    resourceMetadata,
    resolveIdentity,
    async authenticate(request) {
      const header = request.headers.authorization;
      const token = typeof header === 'string' ? /^Bearer ([^\s]+)$/i.exec(header)?.[1] : undefined;
      // Reject duplicated Authorization fields even if Node normalized them to one value.
      const count = request.rawHeaders.filter(
        (_, index) =>
          index % 2 === 0 && request.rawHeaders[index]?.toLowerCase() === 'authorization',
      ).length;
      if (!token || count > 1) throw new Error('MCP_READONLY_AUTH_REQUIRED');
      const verified = await verifier.verify(token);
      const mapping = mappings.get(verified.subject);
      if (
        !mapping ||
        !verified.scopes?.includes('toca:read') ||
        !verified.clientId ||
        verified.expiresAt <= now()
      ) {
        throw new Error('MCP_READONLY_AUTH_REQUIRED');
      }
      const principalId = `mcp-subject:${createHash('sha256')
        .update(JSON.stringify([verified.issuer, verified.subject]))
        .digest('hex')}`;
      const identity: ExecutionIdentity = {
        principal: {
          principalId,
          principalType: 'HUMAN',
          tenantId: mapping.tenantId,
          workspaceId: mapping.workspaceId,
          organizationId: mapping.organizationId,
          authenticationMethod: 'MCP_OAUTH_BEARER',
          authenticatedAt: new Date(now() * 1000).toISOString(),
          expiresAt: new Date(verified.expiresAt * 1000).toISOString(),
          evidence: ['mcp:verified-rs256-subject-mapping'],
        },
        authorization: {
          principalId,
          tenantId: mapping.tenantId,
          roles: ['READER'],
          allowedRouteIds: [],
          allowedCapabilityIds: [],
          allowedTargetAccounts: [],
          evidence: ['mcp:discovery-only'],
        },
      };
      assertExecutionIdentity(identity, new Date(now() * 1000).toISOString());
      const authInfo: AuthInfo = {
        token,
        clientId: verified.clientId,
        scopes: ['toca:read'],
        expiresAt: verified.expiresAt,
      };
      identities.set(authInfo, identity);
      return authInfo;
    },
  };
}

function canonicalHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('MCP_READONLY_CONFIGURATION_INVALID');
  }
  if (
    url.protocol !== 'https:' ||
    value.includes('?') ||
    value.includes('#') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== value
  )
    throw new Error('MCP_READONLY_CONFIGURATION_INVALID');
  return url;
}
