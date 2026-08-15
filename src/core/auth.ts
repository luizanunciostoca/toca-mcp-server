import type { ExecutionIdentity } from './identity.js';

/**
 * Compatibility facade for callers that historically imported auth.ts.
 * M-FOUND-04 uses ExecutionIdentity from identity.ts as the single canonical
 * principal + authorization contract.
 */
export type RequesterIdentity = ExecutionIdentity;

export interface AuthorizationContext {
  readonly requester: RequesterIdentity;
  readonly connectedAccount?: string;
  readonly approvalReference?: string;
}

export {
  AUTHENTICATION_METHODS,
  AUTHORIZATION_ROLES,
  PRINCIPAL_TYPES,
  assertExecutionIdentity,
  authorizeExecution,
  createTrustedServiceExecutionIdentity,
  resolveExecutionIdentityFromMcpContext,
} from './identity.js';

export type {
  AuthenticationMethod,
  AuthorizationDecision,
  AuthorizationExpectation,
  AuthorizationGrant,
  AuthorizationRole,
  ExecutionIdentity,
  ExecutionIdentityResolver,
  ExecutionPrincipal,
  McpAuthInfoLike,
  McpToolContextLike,
  PrincipalType,
  ResolveExecutionIdentityOptions,
} from './identity.js';
