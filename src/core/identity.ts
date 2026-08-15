import type { RiskClass } from './tool-registry.js';
import type { RouteId } from '../governance/types.js';

export const AUTHORIZATION_ROLES = [
  'READER',
  'OPERATOR',
  'EXTERNAL_WRITER',
  'FINANCIAL_OPERATOR',
  'DESTRUCTIVE_OPERATOR',
  'APPROVER',
  'ADMIN',
] as const;
export type AuthorizationRole = (typeof AUTHORIZATION_ROLES)[number];

export const PRINCIPAL_TYPES = ['HUMAN', 'SERVICE', 'AGENT'] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export const AUTHENTICATION_METHODS = [
  'MCP_OAUTH_BEARER',
  'INFRASTRUCTURE_IDENTITY',
  'TEST',
] as const;
export type AuthenticationMethod = (typeof AUTHENTICATION_METHODS)[number];

export interface ExecutionPrincipal {
  readonly principalId: string;
  readonly principalType: PrincipalType;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly authenticationMethod: AuthenticationMethod;
  readonly authenticatedAt: string;
  readonly expiresAt: string | null;
  readonly sessionId?: string;
  readonly evidence: readonly string[];
}

export interface AuthorizationGrant {
  readonly principalId: string;
  readonly tenantId: string;
  readonly roles: readonly AuthorizationRole[];
  readonly allowedRouteIds: readonly RouteId[] | null;
  readonly allowedCapabilityIds: readonly string[] | null;
  readonly allowedTargetAccounts: readonly string[] | null;
  readonly evidence: readonly string[];
}

export interface ExecutionIdentity {
  readonly principal: ExecutionPrincipal;
  readonly authorization: AuthorizationGrant;
}

export interface AuthorizationExpectation {
  readonly routeId?: RouteId;
  readonly capabilityId: string;
  readonly riskClass: RiskClass;
  readonly targetAccount?: string;
  readonly now?: string;
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export interface McpAuthInfoLike {
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: number;
}

export interface McpToolContextLike {
  readonly sessionId?: string;
  readonly http?: {
    readonly authInfo?: McpAuthInfoLike;
  };
}

export interface ResolveExecutionIdentityOptions {
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly organizationId?: string;
  readonly fallbackIdentity?: ExecutionIdentity;
  readonly now?: string;
}

export type ExecutionIdentityResolver = (
  context: McpToolContextLike,
) => ExecutionIdentity | undefined;

const ROLE_SCOPES: Readonly<Record<string, AuthorizationRole>> = {
  'toca:read': 'READER',
  'toca:write': 'OPERATOR',
  'toca:write:external': 'EXTERNAL_WRITER',
  'toca:financial': 'FINANCIAL_OPERATOR',
  'toca:destructive': 'DESTRUCTIVE_OPERATOR',
  'toca:approve': 'APPROVER',
  'toca:admin': 'ADMIN',
};

const REQUIRED_ROLES: Readonly<Record<RiskClass, readonly AuthorizationRole[]>> = {
  READ: [
    'READER',
    'OPERATOR',
    'EXTERNAL_WRITER',
    'FINANCIAL_OPERATOR',
    'DESTRUCTIVE_OPERATOR',
    'ADMIN',
  ],
  WRITE_REVERSIBLE: [
    'OPERATOR',
    'EXTERNAL_WRITER',
    'FINANCIAL_OPERATOR',
    'DESTRUCTIVE_OPERATOR',
    'ADMIN',
  ],
  WRITE_EXTERNAL: ['EXTERNAL_WRITER', 'ADMIN'],
  FINANCIAL_IMPACT: ['FINANCIAL_OPERATOR', 'ADMIN'],
  DESTRUCTIVE: ['DESTRUCTIVE_OPERATOR', 'ADMIN'],
};

export function createTrustedServiceExecutionIdentity(input: {
  readonly principalId: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly organizationId?: string;
  readonly roles: readonly AuthorizationRole[];
  readonly allowedRouteIds?: readonly RouteId[] | null;
  readonly allowedCapabilityIds?: readonly string[] | null;
  readonly allowedTargetAccounts?: readonly string[] | null;
  readonly evidence: readonly string[];
  readonly now?: string;
}): ExecutionIdentity {
  const now = input.now ?? new Date().toISOString();
  const tenantId = requireNonEmpty(input.tenantId, 'IDENTITY_TENANT_REQUIRED');
  const principal: ExecutionPrincipal = {
    principalId: requireNonEmpty(input.principalId, 'IDENTITY_PRINCIPAL_REQUIRED'),
    principalType: 'SERVICE',
    tenantId,
    workspaceId: requireNonEmpty(input.workspaceId ?? tenantId, 'IDENTITY_WORKSPACE_REQUIRED'),
    organizationId: requireNonEmpty(
      input.organizationId ?? tenantId,
      'IDENTITY_ORGANIZATION_REQUIRED',
    ),
    authenticationMethod: 'INFRASTRUCTURE_IDENTITY',
    authenticatedAt: now,
    expiresAt: null,
    evidence: requireEvidence(input.evidence, 'IDENTITY_EVIDENCE_REQUIRED'),
  };
  const authorization: AuthorizationGrant = {
    principalId: principal.principalId,
    tenantId: principal.tenantId,
    roles: unique(input.roles),
    allowedRouteIds: input.allowedRouteIds ? unique(input.allowedRouteIds) : null,
    allowedCapabilityIds: input.allowedCapabilityIds ? unique(input.allowedCapabilityIds) : null,
    allowedTargetAccounts: input.allowedTargetAccounts
      ? unique(input.allowedTargetAccounts)
      : null,
    evidence: requireEvidence(input.evidence, 'AUTHORIZATION_EVIDENCE_REQUIRED'),
  };
  assertExecutionIdentity({ principal, authorization }, now);
  return { principal, authorization };
}

export function resolveExecutionIdentityFromMcpContext(
  context: McpToolContextLike,
  options: ResolveExecutionIdentityOptions,
): ExecutionIdentity | undefined {
  const authInfo = context.http?.authInfo;
  if (!authInfo) return options.fallbackIdentity;

  const now = options.now ?? new Date().toISOString();
  if (!authInfo.clientId.trim()) return undefined;
  if (!authInfo.expiresAt || authInfo.expiresAt * 1000 <= Date.parse(now)) return undefined;

  const scopes = unique(authInfo.scopes.map((scope) => scope.trim()).filter(Boolean));
  const roles = unique(
    scopes
      .map((scope) => ROLE_SCOPES[scope])
      .filter((role): role is AuthorizationRole => role !== undefined),
  );
  const routeScopes = scopes
    .filter((scope) => scope.startsWith('toca:route:'))
    .map((scope) => scope.slice('toca:route:'.length))
    .filter(isRouteScope);
  const capabilityScopes = scopes
    .filter((scope) => scope.startsWith('toca:capability:'))
    .map((scope) => scope.slice('toca:capability:'.length))
    .filter(Boolean);
  const accountScopes = scopes
    .filter((scope) => scope.startsWith('toca:account:'))
    .map((scope) => scope.slice('toca:account:'.length))
    .filter(Boolean);

  const tenantId = requireNonEmpty(options.tenantId, 'IDENTITY_TENANT_REQUIRED');
  const principal: ExecutionPrincipal = {
    principalId: `mcp-client:${authInfo.clientId}`,
    principalType: 'SERVICE',
    tenantId,
    workspaceId: requireNonEmpty(options.workspaceId ?? tenantId, 'IDENTITY_WORKSPACE_REQUIRED'),
    organizationId: requireNonEmpty(
      options.organizationId ?? tenantId,
      'IDENTITY_ORGANIZATION_REQUIRED',
    ),
    authenticationMethod: 'MCP_OAUTH_BEARER',
    authenticatedAt: now,
    expiresAt: new Date(authInfo.expiresAt * 1000).toISOString(),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    evidence: [`mcp-auth:${authInfo.clientId}`],
  };
  const authorization: AuthorizationGrant = {
    principalId: principal.principalId,
    tenantId: principal.tenantId,
    roles,
    allowedRouteIds: routeScopes.length > 0 ? unique(routeScopes) : null,
    allowedCapabilityIds: capabilityScopes.length > 0 ? unique(capabilityScopes) : null,
    // Account-bound side effects remain fail-closed unless the token carries an explicit account scope.
    allowedTargetAccounts: unique(accountScopes),
    evidence: [`mcp-auth-scopes:${scopes.join(',')}`],
  };
  const identity = { principal, authorization } satisfies ExecutionIdentity;
  try {
    assertExecutionIdentity(identity, now);
    return identity;
  } catch {
    return undefined;
  }
}

export function authorizeExecution(
  identity: ExecutionIdentity | undefined,
  expectation: AuthorizationExpectation,
): AuthorizationDecision {
  if (!identity) return deny('IDENTITY_REQUIRED');

  const now = expectation.now ?? new Date().toISOString();
  try {
    assertExecutionIdentity(identity, now);
  } catch (error) {
    return deny(error instanceof Error ? error.message : 'IDENTITY_INVALID');
  }

  const { authorization } = identity;
  if (
    authorization.allowedRouteIds &&
    expectation.routeId &&
    !authorization.allowedRouteIds.includes(expectation.routeId)
  ) {
    return deny('AUTHORIZATION_ROUTE_NOT_ALLOWED');
  }
  if (
    authorization.allowedCapabilityIds &&
    !authorization.allowedCapabilityIds.includes(expectation.capabilityId)
  ) {
    return deny('AUTHORIZATION_CAPABILITY_NOT_ALLOWED');
  }
  if (
    expectation.targetAccount &&
    (!authorization.allowedTargetAccounts ||
      !authorization.allowedTargetAccounts.includes(expectation.targetAccount))
  ) {
    return deny('AUTHORIZATION_TARGET_ACCOUNT_NOT_ALLOWED');
  }

  const requiredRoles = REQUIRED_ROLES[expectation.riskClass];
  if (!authorization.roles.some((role) => requiredRoles.includes(role))) {
    return deny(`AUTHORIZATION_ROLE_REQUIRED:${requiredRoles.join('|')}`);
  }

  return { allowed: true, reason: 'IDENTITY_AND_AUTHORIZATION_VALID' };
}

export function assertExecutionIdentity(
  identity: ExecutionIdentity,
  now = new Date().toISOString(),
): void {
  const { principal, authorization } = identity;
  requireNonEmpty(principal.principalId, 'IDENTITY_PRINCIPAL_REQUIRED');
  requireNonEmpty(principal.tenantId, 'IDENTITY_TENANT_REQUIRED');
  requireNonEmpty(principal.workspaceId, 'IDENTITY_WORKSPACE_REQUIRED');
  requireNonEmpty(principal.organizationId, 'IDENTITY_ORGANIZATION_REQUIRED');
  requireEvidence(principal.evidence, 'IDENTITY_EVIDENCE_REQUIRED');
  requireEvidence(authorization.evidence, 'AUTHORIZATION_EVIDENCE_REQUIRED');
  if (!Number.isFinite(Date.parse(principal.authenticatedAt)))
    throw new Error('IDENTITY_AUTHENTICATED_AT_INVALID');
  if (Date.parse(principal.authenticatedAt) > Date.parse(now))
    throw new Error('IDENTITY_AUTHENTICATED_IN_FUTURE');
  if (principal.expiresAt) {
    if (!Number.isFinite(Date.parse(principal.expiresAt)))
      throw new Error('IDENTITY_EXPIRY_INVALID');
    if (Date.parse(principal.expiresAt) <= Date.parse(now)) throw new Error('IDENTITY_EXPIRED');
  }
  if (authorization.principalId !== principal.principalId)
    throw new Error('AUTHORIZATION_PRINCIPAL_MISMATCH');
  if (authorization.tenantId !== principal.tenantId)
    throw new Error('AUTHORIZATION_TENANT_MISMATCH');
  if (authorization.roles.length === 0) throw new Error('AUTHORIZATION_ROLE_REQUIRED');
}

function isRouteScope(value: string): value is RouteId {
  return /^R(?:0[1-9]|[12][0-9]|3[0-2])$/.test(value);
}

function deny(reason: string): AuthorizationDecision {
  return { allowed: false, reason };
}

function requireNonEmpty(value: string, errorCode: string): string {
  if (!value.trim()) throw new Error(errorCode);
  return value.trim();
}

function requireEvidence(values: readonly string[], errorCode: string): readonly string[] {
  const evidence = unique(values.map((value) => value.trim()).filter(Boolean));
  if (evidence.length === 0) throw new Error(errorCode);
  return evidence;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
