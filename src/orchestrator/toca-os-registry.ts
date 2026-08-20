import type { SecretReference, SecretResolver } from '../core/secrets.js';
import { getRouteDefinition } from '../governance/route-catalog.js';
import { ROUTE_IDS, isRouteId, type RouteId } from '../governance/types.js';
import type { CanonicalArtifactRef, CanonicalArtifactResolver } from './contracts.js';
import type { Ag01DecisionContext } from './production-planning.js';

export interface TocaOsRouteRegistryEntry {
  readonly routeId: RouteId;
  readonly demandType: string;
  readonly triggers: readonly string[];
  readonly primaryAgent: string;
  readonly auxiliaryAgents: readonly string[];
  readonly mandatorySources: readonly string[];
  readonly qualityGate: readonly string[];
  readonly approvalRequired: string;
  readonly mcpRole: string;
  readonly outputStates: readonly string[];
}

export interface TocaOsCanonicalResource {
  readonly resourceId: string;
  readonly driveId: string;
  readonly title: string;
  readonly type: string;
  readonly module: string;
  readonly logicalPath: string;
  readonly status: string;
  readonly purpose: string;
  readonly lastValidatedAt: string;
  readonly governanceStatus: string;
}

export interface TocaOsRegistrySnapshot {
  readonly routes: ReadonlyMap<RouteId, TocaOsRouteRegistryEntry>;
  readonly resources: ReadonlyMap<string, TocaOsCanonicalResource>;
  readonly fetchedAt: string;
  readonly evidence: readonly string[];
}

export interface TocaOsRegistryClient {
  snapshot(forceRefresh?: boolean): Promise<TocaOsRegistrySnapshot>;
}

interface GoogleSheetsRegistryOptions {
  readonly routingSpreadsheetId: string;
  readonly canonicalResourcesSpreadsheetId: string;
  readonly accessTokenReference: SecretReference;
  readonly secrets: SecretResolver;
  readonly cacheTtlMs: number;
  readonly timeoutMs: number;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => Date;
}

interface SheetsValuesResponse {
  readonly values?: readonly (readonly unknown[])[];
}

export class GoogleSheetsTocaOsRegistryClient implements TocaOsRegistryClient {
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  #cache: { readonly expiresAt: number; readonly snapshot: TocaOsRegistrySnapshot } | undefined;
  #inFlight: Promise<TocaOsRegistrySnapshot> | undefined;

  constructor(private readonly options: GoogleSheetsRegistryOptions) {
    this.#fetch = options.fetchFn ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async snapshot(forceRefresh = false): Promise<TocaOsRegistrySnapshot> {
    const nowMs = this.#now().getTime();
    if (!forceRefresh && this.#cache && this.#cache.expiresAt > nowMs) {
      return this.#cache.snapshot;
    }
    if (!forceRefresh && this.#inFlight) return this.#inFlight;

    const load = this.#load().then((snapshot) => {
      this.#cache = {
        expiresAt: this.#now().getTime() + this.options.cacheTtlMs,
        snapshot,
      };
      return snapshot;
    });
    this.#inFlight = load;
    try {
      return await load;
    } finally {
      if (this.#inFlight === load) this.#inFlight = undefined;
    }
  }

  async #load(): Promise<TocaOsRegistrySnapshot> {
    const accessToken = await this.options.secrets.resolve(this.options.accessTokenReference);
    const [routingRows, resourceRows] = await Promise.all([
      this.#fetchRows(
        this.options.routingSpreadsheetId,
        'ROUTING_REGISTRY!A:Z',
        accessToken,
      ),
      this.#fetchRows(
        this.options.canonicalResourcesSpreadsheetId,
        'CANONICAL_RESOURCES!A:Z',
        accessToken,
      ),
    ]);

    const routes = parseRoutes(routingRows);
    const resources = parseResources(resourceRows);
    validateRouteParity(routes);
    if (resources.size === 0) throw new Error('AG01_TOCA_OS_CANONICAL_RESOURCES_EMPTY');

    const fetchedAt = this.#now().toISOString();
    return {
      routes,
      resources,
      fetchedAt,
      evidence: [
        `toca-os:routing-registry:${this.options.routingSpreadsheetId}`,
        `toca-os:canonical-resources:${this.options.canonicalResourcesSpreadsheetId}`,
        `toca-os:registry-fetched-at:${fetchedAt}`,
      ],
    };
  }

  async #fetchRows(
    spreadsheetId: string,
    range: string,
    accessToken: string,
  ): Promise<readonly (readonly unknown[])[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.#fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: 'application/json',
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`AG01_TOCA_OS_REGISTRY_HTTP_ERROR:${response.status}`);
      }
      const body = (await response.json()) as SheetsValuesResponse;
      if (!body.values || body.values.length < 2) {
        throw new Error(`AG01_TOCA_OS_REGISTRY_RANGE_EMPTY:${range}`);
      }
      return body.values;
    } catch (error) {
      if (isAbort(error)) throw new Error(`AG01_TOCA_OS_REGISTRY_TIMEOUT:${range}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class TocaOsCanonicalArtifactResolver implements CanonicalArtifactResolver {
  constructor(
    private readonly registry: TocaOsRegistryClient,
    private readonly decisionContext: Ag01DecisionContext,
  ) {}

  async resolveSop(input: {
    readonly routeId: RouteId;
    readonly primaryAgent: string;
    readonly message: string;
  }): Promise<CanonicalArtifactRef> {
    const decision = this.decisionContext.requireDecision();
    assertDecisionRoute(decision.routeId, input.routeId, decision.agent, input.primaryAgent);
    const snapshot = await this.registry.snapshot();
    const resources = resolveRequiredResources(decision.requiredArtifacts, snapshot);
    const sop = resources.find((resource) => isSopResource(resource.resourceId));
    if (!sop) throw new Error(`AG01_SOP_ARTIFACT_REQUIRED:${input.routeId}`);
    return toArtifactRef(sop, snapshot);
  }

  async resolveTemplate(input: {
    readonly routeId: RouteId;
    readonly primaryAgent: string;
    readonly message: string;
  }): Promise<CanonicalArtifactRef | null> {
    const decision = this.decisionContext.requireDecision();
    assertDecisionRoute(decision.routeId, input.routeId, decision.agent, input.primaryAgent);
    const snapshot = await this.registry.snapshot();
    const resources = resolveRequiredResources(decision.requiredArtifacts, snapshot);
    const template = resources.find((resource) => resource.resourceId.startsWith('TPL-'));
    return template ? toArtifactRef(template, snapshot) : null;
  }
}

export function resolveRequiredResources(
  resourceIds: readonly string[],
  snapshot: TocaOsRegistrySnapshot,
): readonly TocaOsCanonicalResource[] {
  const unique = [...new Set(resourceIds.map((value) => value.trim()).filter(Boolean))];
  if (unique.length === 0) throw new Error('AG01_REQUIRED_ARTIFACTS_EMPTY');
  return unique.map((resourceId) => {
    const resource = snapshot.resources.get(resourceId);
    if (!resource) throw new Error(`AG01_REQUIRED_ARTIFACT_UNKNOWN:${resourceId}`);
    if (resource.status !== 'ACTIVE_CANONICAL') {
      throw new Error(`AG01_REQUIRED_ARTIFACT_NOT_CANONICAL:${resourceId}:${resource.status}`);
    }
    return resource;
  });
}

function parseRoutes(
  rows: readonly (readonly unknown[])[],
): ReadonlyMap<RouteId, TocaOsRouteRegistryEntry> {
  const objects = rowsToObjects(rows, 'AG01_TOCA_OS_ROUTING_REGISTRY_HEADER_INVALID');
  const routes = new Map<RouteId, TocaOsRouteRegistryEntry>();
  for (const row of objects) {
    const rawRouteId = text(row.ROUTE_ID);
    if (!rawRouteId) continue;
    if (!isRouteId(rawRouteId)) throw new Error(`AG01_TOCA_OS_ROUTE_INVALID:${rawRouteId}`);
    if (routes.has(rawRouteId)) throw new Error(`AG01_TOCA_OS_ROUTE_DUPLICATE:${rawRouteId}`);
    routes.set(rawRouteId, {
      routeId: rawRouteId,
      demandType: requiredText(row.DEMAND_TYPE, `AG01_TOCA_OS_DEMAND_TYPE_REQUIRED:${rawRouteId}`),
      triggers: pipe(row.TRIGGERS),
      primaryAgent: requiredText(
        row.PRIMARY_AGENT,
        `AG01_TOCA_OS_PRIMARY_AGENT_REQUIRED:${rawRouteId}`,
      ),
      auxiliaryAgents: pipe(row.AUX_AGENTS),
      mandatorySources: pipe(row.MANDATORY_SOURCES),
      qualityGate: pipe(row.QUALITY_GATE),
      approvalRequired: requiredText(
        row.APPROVAL_REQUIRED,
        `AG01_TOCA_OS_APPROVAL_POLICY_REQUIRED:${rawRouteId}`,
      ),
      mcpRole: requiredText(row.MCP_ROLE, `AG01_TOCA_OS_MCP_ROLE_REQUIRED:${rawRouteId}`),
      outputStates: pipe(row.OUTPUT_STATE),
    });
  }
  return routes;
}

function parseResources(
  rows: readonly (readonly unknown[])[],
): ReadonlyMap<string, TocaOsCanonicalResource> {
  const objects = rowsToObjects(rows, 'AG01_TOCA_OS_CANONICAL_RESOURCES_HEADER_INVALID');
  const resources = new Map<string, TocaOsCanonicalResource>();
  for (const row of objects) {
    const resourceId = text(row.RESOURCE_ID);
    if (!resourceId) continue;
    if (resources.has(resourceId)) {
      throw new Error(`AG01_TOCA_OS_RESOURCE_DUPLICATE:${resourceId}`);
    }
    resources.set(resourceId, {
      resourceId,
      driveId: requiredText(row.DRIVE_ID, `AG01_TOCA_OS_RESOURCE_DRIVE_ID_REQUIRED:${resourceId}`),
      title: requiredText(row.TITLE, `AG01_TOCA_OS_RESOURCE_TITLE_REQUIRED:${resourceId}`),
      type: requiredText(row.TYPE, `AG01_TOCA_OS_RESOURCE_TYPE_REQUIRED:${resourceId}`),
      module: requiredText(row.MODULE, `AG01_TOCA_OS_RESOURCE_MODULE_REQUIRED:${resourceId}`),
      logicalPath: requiredText(
        row.LOGICAL_PATH,
        `AG01_TOCA_OS_RESOURCE_PATH_REQUIRED:${resourceId}`,
      ),
      status: requiredText(row.STATUS, `AG01_TOCA_OS_RESOURCE_STATUS_REQUIRED:${resourceId}`),
      purpose: text(row.PURPOSE),
      lastValidatedAt: text(row.LAST_VALIDATED_AT),
      governanceStatus: text(row.GOVERNANCE_STATUS),
    });
  }
  return resources;
}

function validateRouteParity(routes: ReadonlyMap<RouteId, TocaOsRouteRegistryEntry>): void {
  for (const routeId of ROUTE_IDS) {
    const drive = routes.get(routeId);
    if (!drive) throw new Error(`AG01_TOCA_OS_ROUTE_MISSING:${routeId}`);
    const local = getRouteDefinition(routeId);
    if (drive.primaryAgent !== local.primaryAgent) {
      throw new Error(
        `AG01_TOCA_OS_ROUTE_AGENT_DRIFT:${routeId}:${drive.primaryAgent}:${local.primaryAgent}`,
      );
    }
    if (!sameSet(drive.auxiliaryAgents, local.auxiliaryAgents)) {
      throw new Error(`AG01_TOCA_OS_ROUTE_AUX_AGENT_DRIFT:${routeId}`);
    }
  }
}

function rowsToObjects(
  rows: readonly (readonly unknown[])[],
  headerError: string,
): readonly Readonly<Record<string, unknown>>[] {
  const headerRow = rows[0];
  if (!headerRow) throw new Error(headerError);
  const headers = headerRow.map((value) => text(value));
  if (headers.every((value) => value.length === 0)) throw new Error(headerError);
  return rows.slice(1).map((row) => {
    const output: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (header) output[header] = row[index];
    });
    return output;
  });
}

function toArtifactRef(
  resource: TocaOsCanonicalResource,
  snapshot: TocaOsRegistrySnapshot,
): CanonicalArtifactRef {
  return {
    artifactId: resource.resourceId,
    version: artifactVersion(resource),
    sourceRef: resource.logicalPath,
    evidence: [
      `toca-os:resource:${resource.resourceId}`,
      `drive:file:${resource.driveId}`,
      `toca-os:status:${resource.status}`,
      ...(resource.lastValidatedAt
        ? [`toca-os:last-validated:${resource.lastValidatedAt}`]
        : []),
      ...snapshot.evidence,
    ],
  };
}

function artifactVersion(resource: TocaOsCanonicalResource): string {
  const match = resource.title.match(/(?:^|[_\s-])v(\d+(?:\.\d+){1,2})(?:\b|\s|$)/i);
  if (match?.[1]) return match[1];
  return resource.lastValidatedAt ? `canonical@${resource.lastValidatedAt}` : 'canonical';
}

function isSopResource(resourceId: string): boolean {
  return resourceId.startsWith('SOP-') || resourceId.startsWith('PIPE-');
}

function assertDecisionRoute(
  decisionRouteId: RouteId,
  routeId: RouteId,
  decisionAgent: string,
  primaryAgent: string,
): void {
  if (decisionRouteId !== routeId) {
    throw new Error(`AG01_DECISION_ROUTE_CONTEXT_MISMATCH:${decisionRouteId}:${routeId}`);
  }
  if (decisionAgent !== primaryAgent) {
    throw new Error(`AG01_DECISION_AGENT_CONTEXT_MISMATCH:${decisionAgent}:${primaryAgent}`);
  }
}

function pipe(value: unknown): string[] {
  return text(value)
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  return '';
}

function requiredText(value: unknown, errorCode: string): string {
  const output = text(value);
  if (!output) throw new Error(errorCode);
  return output;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((value) => expected.has(value));
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
