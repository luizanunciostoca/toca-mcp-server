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
  'COGNITIVE' | 'CONNECTOR' | 'MCP_TOOL' | 'INTERNAL_ENGINE' | 'CATALOG_ONLY';

export interface JsonSchemaReference {
  readonly $id: string;
  readonly type: 'object';
  readonly additionalProperties: boolean;
  readonly required?: readonly string[];
}

export interface RetryPolicyDefinition {
  readonly max_attempts: number;
  readonly strategy: 'NONE' | 'FIXED' | 'EXPONENTIAL_BACKOFF';
  readonly retryable_errors: readonly string[];
}

export interface CapabilityDefinition {
  readonly capability_id: string;
  readonly route_id: RouteId | 'TRANSVERSAL';
  readonly version: string;
  readonly description: string;
  readonly lifecycle_status: CapabilityStatus;
  readonly risk_class: RiskClass;
  readonly side_effects: boolean;
  readonly approval_required: boolean;
  readonly idempotent: boolean;
  readonly provider: string;
  readonly required_scopes: readonly string[];
  readonly required_config: readonly string[];
  readonly input_schema: JsonSchemaReference;
  readonly output_schema: JsonSchemaReference;
  readonly timeout_ms: number;
  readonly retry_policy: RetryPolicyDefinition;
  readonly verification_method: string;
  readonly rollback_method: string;
  readonly owner: string;
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
