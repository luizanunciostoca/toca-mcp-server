import type { CapabilityStatus, RiskClass } from '../core/tool-registry.js';

export const ROUTE_IDS = [
  'R01',
  'R02',
  'R03',
  'R04',
  'R05',
  'R06',
  'R07',
  'R08',
  'R09',
  'R10',
  'R11',
  'R12',
  'R13',
  'R14',
  'R15',
  'R16',
  'R17',
  'R18',
  'R19',
  'R20',
  'R21',
  'R22',
  'R23',
  'R24',
  'R25',
  'R26',
  'R27',
  'R28',
  'R29',
  'R30',
  'R31',
  'R32',
] as const;

export type RouteId = (typeof ROUTE_IDS)[number];
export type RoutePriority = 'P0' | 'P1' | 'P2' | 'UNSPECIFIED';

export interface RouteDefinition {
  readonly routeId: RouteId;
  readonly name: string;
  readonly purpose: string;
  readonly priority: RoutePriority;
  readonly primaryAgent: string;
  readonly auxiliaryAgents: readonly string[];
  readonly subflows: readonly string[];
  readonly initialState: string;
  readonly terminalStates: readonly string[];
  readonly capabilityIds: readonly string[];
}

export type ExecutionSurface =
  | 'COGNITIVE'
  | 'CONNECTOR'
  | 'MCP_TOOL'
  | 'INTERNAL_ENGINE'
  | 'CATALOG_ONLY';

export type CapabilityContractQuality = 'EXPLICIT' | 'RUNTIME_BOUND' | 'LEGACY_INFERRED';

export type AuthenticationMode =
  | 'NONE'
  | 'INTERNAL'
  | 'META_FACEBOOK_LOGIN'
  | 'META_INSTAGRAM_LOGIN'
  | 'META_SYSTEM_USER'
  | 'OAUTH2'
  | 'SERVICE_ACCOUNT'
  | 'WORKLOAD_IDENTITY'
  | 'UNKNOWN';

export type ProviderAccessLevel =
  | 'READ'
  | 'MANAGE'
  | 'PUBLISH'
  | 'MESSAGE'
  | 'COMMENT'
  | 'ADMIN';

export interface ProviderPermissionRequirement {
  readonly provider: string;
  readonly authentication_mode: AuthenticationMode;
  readonly operation: string;
  readonly scopes: readonly string[];
  readonly access_level: ProviderAccessLevel;
  readonly validated_at: string | null;
  readonly evidence: readonly string[];
}

export type JsonSchemaPrimitiveType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null';

export interface JsonSchemaNode {
  readonly type?: JsonSchemaPrimitiveType | readonly JsonSchemaPrimitiveType[];
  readonly description?: string;
  readonly enum?: readonly (string | number | boolean | null)[];
  readonly const?: string | number | boolean | null;
  readonly format?: string;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchemaNode;
  readonly additionalProperties?: boolean | JsonSchemaNode;
  readonly anyOf?: readonly JsonSchemaNode[];
  readonly oneOf?: readonly JsonSchemaNode[];
}

export interface JsonSchemaReference extends JsonSchemaNode {
  readonly $id: string;
  readonly type: 'object';
  readonly additionalProperties: boolean | JsonSchemaNode;
}

export interface RetryPolicyDefinition {
  readonly max_attempts: number;
  readonly strategy: 'NONE' | 'FIXED' | 'EXPONENTIAL_BACKOFF';
  readonly retryable_errors: readonly string[];
}

export interface CapabilityDefinition {
  readonly capability_id: string;
  /** @deprecated Use primary_route_id. Kept for compatibility through catalog v1.x. */
  readonly route_id: RouteId | 'TRANSVERSAL';
  readonly primary_route_id: RouteId | 'TRANSVERSAL';
  readonly consumer_route_ids: readonly RouteId[];
  /** Compatibility IDs that resolve to this canonical capability. */
  readonly aliases: readonly string[];
  /** Canonical identity after compatibility alias resolution. */
  readonly canonical_capability_id: string;
  /** True when this catalog entry is retained only as a backwards-compatible alias. */
  readonly is_compatibility_alias: boolean;
  /** Canonical replacement for an alias entry, otherwise null. */
  readonly replacement_capability_id: string | null;
  /** Catalog contract version in which an alias became deprecated, otherwise null. */
  readonly deprecated_since: string | null;
  readonly version: string;
  readonly description: string;
  readonly contract_quality: CapabilityContractQuality;
  readonly lifecycle_status: CapabilityStatus;
  readonly risk_class: RiskClass;
  readonly side_effects: boolean;
  readonly approval_required: boolean;
  readonly idempotent: boolean;
  readonly provider: string;
  readonly operation: string;
  readonly authentication_mode: AuthenticationMode;
  /** Current runtime scopes when a concrete runtime mode is known. */
  readonly required_scopes: readonly string[];
  /** Provider/auth-mode alternatives for the operation. */
  readonly permission_requirements: readonly ProviderPermissionRequirement[];
  readonly required_config: readonly string[];
  readonly input_schema: JsonSchemaReference;
  readonly output_schema: JsonSchemaReference;
  readonly timeout_ms: number;
  readonly retry_policy: RetryPolicyDefinition;
  readonly verification_method: string;
  readonly rollback_method: string;
  readonly owner: string;
  readonly reviewer_role: string;
  readonly approver_role: string;
  readonly last_validated_at: string | null;
  readonly evidence: readonly string[];
  readonly execution_surface: ExecutionSurface;
}

export function isRouteId(value: string): value is RouteId {
  return (ROUTE_IDS as readonly string[]).includes(value);
}

export function assertCapabilityNamespace(capabilityId: string): void {
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(capabilityId)) {
    throw new Error(`CAPABILITY_NAMESPACE_INVALID:${capabilityId}`);
  }
}
