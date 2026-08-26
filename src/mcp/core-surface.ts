import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { AuditSink } from '../core/audit.js';
import type { AuditLedgerRecord, AuditLedgerVerification } from '../core/audit-ledger.js';
import type { AutonomyRuntimeContextResolver } from '../core/autonomy-runtime-context.js';
import type { ExecutionIdentity, ExecutionIdentityResolver } from '../core/identity.js';
import { requiresFormalApproval } from '../core/policy.js';
import type { ToolRegistry } from '../core/tool-registry.js';
import type { EventRecordStore } from '../events/event-record.js';
import { toApprovalRecordWire, type ApprovalStore } from '../governance/approval-governance.js';
import { bindApprovalStoreToScope } from '../governance/approval-scope.js';
import {
  getEffectiveCapabilityCatalog,
  resolveCapabilityDefinition,
} from '../governance/capability-resolution.js';
import { ROUTE_IDS } from '../governance/types.js';
import type { WorkflowSnapshot, WorkflowStore } from '../workflow/workflow-contracts.js';
import {
  executeCoreCapability,
  requestCoreApproval,
  resolveCoreRuntimeExecution,
  type CoreCapabilityRuntimeResolver,
} from './core-execution.js';

export const CORE_MCP_SURFACE_VERSION = '1.0.0';
export const CORE_MCP_TOOL_NAMES = [
  'toca.system.health',
  'toca.capabilities.search',
  'toca.capabilities.describe',
  'toca.workflow.create',
  'toca.workflow.get',
  'toca.workflow.advance',
  'toca.approval.request',
  'toca.approval.list',
  'toca.approval.get',
  'toca.execute',
  'toca.verify',
  'toca.audit.query',
  'toca.event.get',
] as const;

export interface CoreAuditQuerySink extends AuditSink {
  verifyExecution(executionId: string): Promise<AuditLedgerVerification>;
  listByCorrelation(correlationId: string, limit?: number): Promise<readonly AuditLedgerRecord[]>;
}

export interface TocaCoreSurfaceDependencies {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly registry: ToolRegistry;
  readonly runtimeResolver: CoreCapabilityRuntimeResolver;
  readonly resolveIdentity: ExecutionIdentityResolver;
  readonly workflowStore?: WorkflowStore;
  readonly approvalStore?: ApprovalStore;
  readonly auditStore?: CoreAuditQuerySink;
  readonly eventStore?: EventRecordStore;
  readonly autonomyContextResolver?: AutonomyRuntimeContextResolver;
}

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const idempotentWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const mutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const executeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;
const evidenceSchema = z.array(z.string().min(1)).min(1).max(100);
const capabilityIdSchema = z.string().min(3).max(200);
const correlationIdSchema = z.string().min(1).max(300);
const workflowStepSchema = z.object({
  stepId: z.string().min(1),
  name: z.string().min(1),
  capabilityId: capabilityIdSchema.nullable().optional(),
  input: z.unknown().optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
  dependsOn: z.array(z.string().min(1)).max(100).optional(),
});
const workflowAdvanceSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('COMPLETE_STEP'),
    workflowId: z.string().min(1),
    stepId: z.string().min(1),
    executionId: z.string().min(1),
    output: z.unknown().optional(),
    evidence: evidenceSchema,
  }),
  z.object({
    action: z.literal('FAIL_STEP'),
    workflowId: z.string().min(1),
    stepId: z.string().min(1),
    executionId: z.string().min(1),
    errorCode: z.string().min(1),
    evidence: evidenceSchema,
  }),
  z.object({
    action: z.literal('RETRY_STEP'),
    workflowId: z.string().min(1),
    stepId: z.string().min(1),
    evidence: evidenceSchema,
  }),
  z.object({
    action: z.literal('OPEN_HUMAN_TASK'),
    workflowId: z.string().min(1),
    stepId: z.string().min(1),
    executionId: z.string().min(1),
    taskId: z.string().min(1),
    requiredRole: z.string().min(1).nullable().optional(),
    payload: z.unknown().optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    evidence: evidenceSchema,
  }),
  z.object({
    action: z.literal('CLAIM_HUMAN_TASK'),
    workflowId: z.string().min(1),
    taskId: z.string().min(1),
    evidence: evidenceSchema,
  }),
  z.object({
    action: z.literal('COMPLETE_HUMAN_TASK'),
    workflowId: z.string().min(1),
    taskId: z.string().min(1),
    completion: z.unknown().optional(),
    evidence: evidenceSchema,
  }),
  z.object({
    action: z.literal('SCHEDULE_TIMER'),
    workflowId: z.string().min(1),
    stepId: z.string().min(1),
    executionId: z.string().min(1),
    timerId: z.string().min(1),
    fireAt: z.string().datetime({ offset: true }),
    payload: z.unknown().optional(),
    evidence: evidenceSchema,
  }),
  z.object({
    action: z.literal('ACTIVATE_COMPENSATIONS'),
    workflowId: z.string().min(1),
    evidence: evidenceSchema,
  }),
]);

export function registerTocaCoreSurface(
  server: McpServer,
  dependencies: TocaCoreSurfaceDependencies,
): void {
  server.registerTool(
    'toca.system.health',
    {
      title: 'TOCA Core Health',
      description: 'Return deterministic TOCA Core MCP surface and persistence readiness metadata.',
      inputSchema: z.object({}),
      annotations: readAnnotations,
    },
    () =>
      response({
        status: 'ok',
        service: dependencies.serviceName,
        version: dependencies.serviceVersion,
        surfaceVersion: CORE_MCP_SURFACE_VERSION,
        toolCount: CORE_MCP_TOOL_NAMES.length,
        persistence: {
          workflow: Boolean(dependencies.workflowStore),
          approval: Boolean(dependencies.approvalStore),
          audit: Boolean(dependencies.auditStore),
          event: Boolean(dependencies.eventStore),
        },
      }),
  );

  server.registerTool(
    'toca.capabilities.search',
    {
      title: 'Search TOCA Capabilities',
      description:
        'Search the canonical capability catalog without materializing one MCP tool per capability.',
      inputSchema: z.object({
        query: z.string().max(200).optional(),
        routeId: z.enum(ROUTE_IDS).optional(),
        provider: z.string().max(100).optional(),
        executableOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(25),
      }),
      annotations: readAnnotations,
    },
    ({ query, routeId, provider, executableOnly, limit }) => {
      const needle = query?.trim().toLowerCase();
      const providerNeedle = provider?.trim().toLowerCase();
      const catalog = getEffectiveCapabilityCatalog();
      const capabilities = catalog.capabilities
        .map((definition) => ({
          definition,
          executable: isRuntimeExecutable(definition.capability_id, dependencies),
        }))
        .filter(({ definition, executable }) => {
          if (executableOnly && !executable) return false;
          if (
            routeId &&
            definition.primary_route_id !== routeId &&
            !definition.consumer_route_ids.includes(routeId)
          )
            return false;
          if (providerNeedle && !definition.provider.toLowerCase().includes(providerNeedle))
            return false;
          if (
            needle &&
            ![
              definition.capability_id,
              definition.description,
              definition.provider,
              definition.operation,
              ...definition.aliases,
            ].some((value) => value.toLowerCase().includes(needle))
          )
            return false;
          return true;
        })
        .slice(0, limit)
        .map(({ definition, executable }) => ({
          capabilityId: definition.capability_id,
          description: definition.description,
          routeId: definition.primary_route_id,
          riskClass: definition.risk_class,
          lifecycleStatus: definition.lifecycle_status,
          provider: definition.provider,
          sideEffects: definition.side_effects,
          approvalRequired: definition.approval_required,
          executionSurface: definition.execution_surface,
          executable,
        }));
      return response({
        catalog: {
          rawCount: catalog.raw_count,
          effectiveCount: catalog.effective_count,
          compatibilityAliasCount: catalog.compatibility_alias_count,
        },
        capabilities,
      });
    },
  );

  server.registerTool(
    'toca.capabilities.describe',
    {
      title: 'Describe TOCA Capability',
      description:
        'Resolve aliases and return the canonical typed, policy and lifecycle contract for one capability.',
      inputSchema: z.object({ capabilityId: capabilityIdSchema }),
      annotations: readAnnotations,
    },
    ({ capabilityId }) => {
      const resolved = resolveCapabilityDefinition(capabilityId);
      if (!resolved) throw new Error(`CAPABILITY_UNKNOWN:${capabilityId}`);
      const definition = resolved.canonical_definition;
      return response({
        requestedId: resolved.requested_id,
        canonicalId: resolved.canonical_id,
        compatibilityAlias: resolved.is_compatibility_alias,
        aliases: resolved.aliases,
        primaryRouteId: definition.primary_route_id,
        consumerRouteIds: definition.consumer_route_ids,
        version: definition.version,
        description: definition.description,
        contractQuality: definition.contract_quality,
        lifecycleStatus: definition.lifecycle_status,
        riskClass: definition.risk_class,
        sideEffects: definition.side_effects,
        approvalRequired: definition.approval_required,
        idempotent: definition.idempotent,
        provider: definition.provider,
        operation: definition.operation,
        authenticationMode: definition.authentication_mode,
        requiredScopes: definition.required_scopes,
        permissionRequirements: definition.permission_requirements,
        requiredConfig: definition.required_config,
        inputSchema: definition.input_schema,
        outputSchema: definition.output_schema,
        verificationMethod: definition.verification_method,
        rollbackMethod: definition.rollback_method,
        executionSurface: definition.execution_surface,
        executable: isRuntimeExecutable(definition.capability_id, dependencies),
      });
    },
  );

  server.registerTool(
    'toca.workflow.create',
    {
      title: 'Create TOCA Workflow',
      description:
        'Create a durable tenant-scoped workflow using the existing workflow engine and transactional outbox.',
      inputSchema: z.object({
        routeId: z.enum(ROUTE_IDS),
        definitionId: z.string().min(1),
        definitionVersion: z.string().min(1),
        idempotencyKey: z.string().min(1),
        correlationId: correlationIdSchema,
        input: z.unknown().optional(),
        steps: z.array(workflowStepSchema).min(1).max(200),
      }),
      annotations: idempotentWriteAnnotations,
    },
    async (input, context) => {
      const identity = requireIdentity(dependencies, context);
      requireMutationRole(identity);
      const store = requireStore(dependencies.workflowStore, 'WORKFLOW_STORE_REQUIRED');
      const steps = input.steps.map((step) => {
        const capabilityId = step.capabilityId
          ? (() => {
              const resolved = resolveCapabilityDefinition(step.capabilityId);
              if (!resolved) throw new Error(`WORKFLOW_CAPABILITY_UNKNOWN:${step.capabilityId}`);
              return resolved.canonical_id;
            })()
          : step.capabilityId;
        return {
          stepId: step.stepId,
          name: step.name,
          ...(capabilityId !== undefined ? { capabilityId } : {}),
          ...(step.input !== undefined ? { input: step.input } : {}),
          ...(step.maxAttempts !== undefined ? { maxAttempts: step.maxAttempts } : {}),
          ...(step.dependsOn !== undefined ? { dependsOn: step.dependsOn } : {}),
        };
      });
      const workflowId = deterministicWorkflowId(identity.principal.tenantId, input.idempotencyKey);
      const snapshot = await store.create({
        workflowId,
        routeId: input.routeId,
        definitionId: input.definitionId,
        definitionVersion: input.definitionVersion,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        tenantId: identity.principal.tenantId,
        workspaceId: identity.principal.workspaceId,
        organizationId: identity.principal.organizationId,
        requesterPrincipalId: identity.principal.principalId,
        ...(input.input !== undefined ? { input: input.input } : {}),
        steps,
      });
      return response({ workflow: snapshot });
    },
  );

  server.registerTool(
    'toca.workflow.get',
    {
      title: 'Get TOCA Workflow',
      description: 'Read one durable workflow inside the authenticated tenant boundary.',
      inputSchema: z.object({ workflowId: z.string().min(1) }),
      annotations: readAnnotations,
    },
    async ({ workflowId }, context) => {
      const identity = requireIdentity(dependencies, context);
      const store = requireStore(dependencies.workflowStore, 'WORKFLOW_STORE_REQUIRED');
      const snapshot = await requireTenantWorkflow(store, workflowId, identity);
      return response({ workflow: snapshot });
    },
  );

  server.registerTool(
    'toca.workflow.advance',
    {
      title: 'Advance TOCA Workflow',
      description:
        'Apply one explicit, evidence-bearing transition through the existing durable workflow engine.',
      inputSchema: workflowAdvanceSchema,
      annotations: mutationAnnotations,
    },
    async (input, context) => {
      const identity = requireIdentity(dependencies, context);
      requireMutationRole(identity);
      const store = requireStore(dependencies.workflowStore, 'WORKFLOW_STORE_REQUIRED');
      const authorizedWorkflow = await requireTenantWorkflow(store, input.workflowId, identity);
      const now = new Date().toISOString();
      let snapshot: WorkflowSnapshot;
      switch (input.action) {
        case 'COMPLETE_STEP':
          snapshot = await store.completeStep({
            workflowId: input.workflowId,
            stepId: input.stepId,
            executionId: input.executionId,
            ...(input.output !== undefined ? { output: input.output } : {}),
            evidence: input.evidence,
            now,
          });
          break;
        case 'FAIL_STEP':
          snapshot = await store.failStep({
            workflowId: input.workflowId,
            stepId: input.stepId,
            executionId: input.executionId,
            errorCode: input.errorCode,
            evidence: input.evidence,
            now,
          });
          break;
        case 'RETRY_STEP':
          snapshot = await store.retryStep({
            workflowId: input.workflowId,
            stepId: input.stepId,
            evidence: input.evidence,
            now,
          });
          break;
        case 'OPEN_HUMAN_TASK':
          snapshot = await store.openHumanTask({
            taskId: input.taskId,
            workflowId: input.workflowId,
            stepId: input.stepId,
            executionId: input.executionId,
            ...(input.requiredRole !== undefined ? { requiredRole: input.requiredRole } : {}),
            ...(input.payload !== undefined ? { payload: input.payload } : {}),
            ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
            evidence: input.evidence,
            now,
          });
          break;
        case 'CLAIM_HUMAN_TASK':
          assertWorkflowHumanTask(authorizedWorkflow, input.taskId);
          snapshot = await store.claimHumanTask({
            taskId: input.taskId,
            principalId: identity.principal.principalId,
            principalRoles: identity.authorization.roles,
            evidence: input.evidence,
            now,
          });
          break;
        case 'COMPLETE_HUMAN_TASK':
          assertWorkflowHumanTask(authorizedWorkflow, input.taskId);
          snapshot = await store.completeHumanTask({
            taskId: input.taskId,
            principalId: identity.principal.principalId,
            ...(input.completion !== undefined ? { completion: input.completion } : {}),
            evidence: input.evidence,
            now,
          });
          break;
        case 'SCHEDULE_TIMER':
          snapshot = await store.scheduleTimer({
            timerId: input.timerId,
            workflowId: input.workflowId,
            stepId: input.stepId,
            executionId: input.executionId,
            fireAt: input.fireAt,
            ...(input.payload !== undefined ? { payload: input.payload } : {}),
            evidence: input.evidence,
            now,
          });
          break;
        case 'ACTIVATE_COMPENSATIONS':
          snapshot = await store.activateCompensations({
            workflowId: input.workflowId,
            evidence: input.evidence,
            now,
          });
          break;
      }
      assertTenant(snapshot.instance.tenantId, identity);
      return response({ workflow: snapshot });
    },
  );

  server.registerTool(
    'toca.approval.request',
    {
      title: 'Request TOCA Approval',
      description:
        'Create a formal ApprovalRecord bound to the exact typed execution payload and authenticated requester.',
      inputSchema: z.object({
        capabilityId: capabilityIdSchema,
        payload: z.unknown(),
        correlationId: correlationIdSchema,
        expiresAt: z.string().datetime({ offset: true }),
        evidence: evidenceSchema,
      }),
      annotations: mutationAnnotations,
    },
    async (input, context) => {
      const identity = requireIdentity(dependencies, context);
      const approvalStore = dependencies.approvalStore
        ? bindApprovalStoreToScope(dependencies.approvalStore, identity.principal)
        : undefined;
      const approval = await requestCoreApproval(input, identity, {
        registry: dependencies.registry,
        runtimeResolver: dependencies.runtimeResolver,
        ...(approvalStore ? { approvalStore } : {}),
      });
      return response({ approval: toApprovalRecordWire(approval) });
    },
  );

  server.registerTool(
    'toca.approval.list',
    {
      title: 'List TOCA Approvals',
      description:
        'List ApprovalRecords inside the authenticated tenant/workspace/organization boundary.',
      inputSchema: z.object({
        status: z
          .enum([
            'REQUESTED',
            'APPROVED',
            'RESERVED',
            'EXECUTING',
            'PROVIDER_READBACK',
            'CONSUMED',
            'RELEASED',
            'FAILED_REVIEW_REQUIRED',
            'REVOKED',
            'EXPIRED',
          ])
          .optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: readAnnotations,
    },
    async ({ status, limit }, context) => {
      const identity = requireIdentity(dependencies, context);
      requireMutationRole(identity);
      const store = requireStore(dependencies.approvalStore, 'APPROVAL_STORE_REQUIRED');
      const scoped = bindApprovalStoreToScope(store, identity.principal);
      const approvals = await scoped.list({ ...(status ? { status } : {}), limit });
      return response({ approvals: approvals.map(toApprovalRecordWire) });
    },
  );

  server.registerTool(
    'toca.approval.get',
    {
      title: 'Get TOCA Approval',
      description: 'Read one ApprovalRecord owned by the authenticated requester.',
      inputSchema: z.object({ approvalId: z.string().min(1) }),
      annotations: readAnnotations,
    },
    async ({ approvalId }, context) => {
      const identity = requireIdentity(dependencies, context);
      const store = requireStore(dependencies.approvalStore, 'APPROVAL_STORE_REQUIRED');
      const scoped = bindApprovalStoreToScope(store, identity.principal);
      const approval = await scoped.get(approvalId);
      if (!approval) throw new Error('APPROVAL_NOT_FOUND');
      if (approval.requester !== identity.principal.principalId) {
        throw new Error('APPROVAL_ACCESS_DENIED');
      }
      return response({ approval: toApprovalRecordWire(approval) });
    },
  );

  server.registerTool(
    'toca.execute',
    {
      title: 'Execute TOCA Capability',
      description:
        'Resolve identity, capability, typed schema, policy, risk, approval, idempotency, handler, provider read-back and audit before reporting success.',
      inputSchema: z.object({
        capabilityId: capabilityIdSchema,
        payload: z.unknown(),
        correlationId: correlationIdSchema,
        approvalId: z.string().min(1).optional(),
      }),
      annotations: executeAnnotations,
    },
    async (input, context) => {
      const identity = requireIdentity(dependencies, context);
      const auditStore = requireStore(dependencies.auditStore, 'AUDIT_STORE_REQUIRED');
      const executionInput = {
        capabilityId: input.capabilityId,
        payload: input.payload,
        correlationId: input.correlationId,
        ...(input.approvalId !== undefined ? { approvalId: input.approvalId } : {}),
      };
      const approvalStore = dependencies.approvalStore
        ? bindApprovalStoreToScope(dependencies.approvalStore, identity.principal)
        : undefined;
      return response(
        await executeCoreCapability(executionInput, identity, {
          registry: dependencies.registry,
          runtimeResolver: dependencies.runtimeResolver,
          auditSink: auditStore,
          ...(approvalStore ? { approvalStore } : {}),
          ...(dependencies.autonomyContextResolver
            ? { autonomyContextResolver: dependencies.autonomyContextResolver }
            : {}),
        }),
      );
    },
  );

  server.registerTool(
    'toca.verify',
    {
      title: 'Verify TOCA Execution',
      description:
        'Verify the immutable audit chain, exact execution descriptor and fresh provider state for side effects.',
      inputSchema: z.object({
        executionId: z.string().min(1),
        correlationId: correlationIdSchema,
        capabilityId: capabilityIdSchema,
        payload: z.unknown(),
        result: z.unknown(),
      }),
      annotations: readAnnotations,
    },
    async (input, context) => {
      const identity = requireIdentity(dependencies, context);
      const auditStore = requireStore(dependencies.auditStore, 'AUDIT_STORE_REQUIRED');
      const records = (await auditStore.listByCorrelation(input.correlationId, 500)).filter(
        (record) => record.executionId === input.executionId,
      );
      if (records.length === 0) throw new Error('AUDIT_EXECUTION_NOT_FOUND');
      for (const record of records) {
        assertTenant(record.tenantId ?? '', identity);
        if (record.requester !== identity.principal.principalId) {
          throw new Error('VERIFY_REQUESTER_EXECUTION_MISMATCH');
        }
      }
      const audit = await auditStore.verifyExecution(input.executionId);
      const resolved = resolveCoreRuntimeExecution(input.capabilityId, input.payload, identity, {
        registry: dependencies.registry,
        runtimeResolver: dependencies.runtimeResolver,
      });
      if (records.some((record) => record.toolName !== resolved.capabilityId)) {
        throw new Error('VERIFY_CAPABILITY_EXECUTION_MISMATCH');
      }
      const succeeded = records.find((record) => record.status === 'SUCCEEDED');
      if (!succeeded) throw new Error('VERIFY_EXECUTION_NOT_SUCCEEDED');
      const descriptorEvidence = `core:descriptor-sha256:${resolved.descriptorSha256}`;
      if (!succeeded.evidence.includes(descriptorEvidence)) {
        throw new Error('VERIFY_DESCRIPTOR_EXECUTION_MISMATCH');
      }

      let provider = {
        required: false,
        verified: true,
        evidence: [] as readonly string[],
        auditedResourceId: undefined as string | undefined,
        readbackResourceId: undefined as string | undefined,
      };
      if (resolved.tool.sideEffects) {
        if (!resolved.binding.providerReadback) throw new Error('PROVIDER_READBACK_REQUIRED');
        const readback = await resolved.binding.providerReadback(input.result, resolved.payload);
        const evidence = normalizeEvidence(readback.evidence);
        const readbackResourceId = normalizeOptional(readback.externalResourceId);
        const auditedResourceId = normalizeOptional(succeeded.externalResourceId);
        provider = {
          required: true,
          verified:
            readback.verified &&
            evidence.length > 0 &&
            readbackResourceId !== undefined &&
            auditedResourceId !== undefined &&
            readbackResourceId === auditedResourceId,
          evidence,
          auditedResourceId,
          readbackResourceId,
        };
      }
      return response({
        executionId: input.executionId,
        correlationId: input.correlationId,
        capabilityId: resolved.capabilityId,
        descriptorBound: true,
        verified: audit.valid && provider.verified,
        audit,
        provider,
      });
    },
  );

  server.registerTool(
    'toca.audit.query',
    {
      title: 'Query TOCA Audit',
      description:
        'Read immutable audit-ledger records by correlation inside the authenticated tenant boundary.',
      inputSchema: z.object({
        correlationId: correlationIdSchema,
        executionId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      annotations: readAnnotations,
    },
    async ({ correlationId, executionId, limit }, context) => {
      const identity = requireIdentity(dependencies, context);
      const auditStore = requireStore(dependencies.auditStore, 'AUDIT_STORE_REQUIRED');
      const records = (await auditStore.listByCorrelation(correlationId, limit))
        .filter((record) => record.tenantId === identity.principal.tenantId)
        .filter((record) => !executionId || record.executionId === executionId);
      return response({ records });
    },
  );

  server.registerTool(
    'toca.event.get',
    {
      title: 'Get TOCA EventRecord',
      description: 'Read one canonical EventRecord inside the authenticated tenant boundary.',
      inputSchema: z.object({ eventId: z.string().min(1) }),
      annotations: readAnnotations,
    },
    async ({ eventId }, context) => {
      const identity = requireIdentity(dependencies, context);
      const store = requireStore(dependencies.eventStore, 'EVENT_STORE_REQUIRED');
      const event = await store.get(eventId);
      if (!event) throw new Error('EVENT_RECORD_NOT_FOUND');
      assertTenant(event.tenantId, identity);
      return response({ event });
    },
  );
}

function isRuntimeExecutable(
  capabilityId: string,
  dependencies: Pick<
    TocaCoreSurfaceDependencies,
    'registry' | 'runtimeResolver' | 'auditStore' | 'approvalStore'
  >,
): boolean {
  const resolved = resolveCapabilityDefinition(capabilityId);
  const tool = dependencies.registry.get(capabilityId);
  const binding = dependencies.runtimeResolver(capabilityId);
  if (!resolved || !tool || !binding || !dependencies.auditStore) return false;
  const canonical = resolved.canonical_definition;
  if (
    tool.riskClass !== canonical.risk_class ||
    tool.sideEffects !== canonical.side_effects ||
    tool.capabilityStatus !== canonical.lifecycle_status ||
    tool.idempotent !== canonical.idempotent ||
    requiresFormalApproval(tool) !== canonical.approval_required
  ) {
    return false;
  }
  if (
    ['PLANNED', 'SPECIFIED', 'DISABLED', 'BLOCKED', 'SUSPENDED', 'RETIRED', 'REMOVED'].includes(
      tool.capabilityStatus,
    )
  ) {
    return false;
  }
  if (tool.sideEffects) {
    if (tool.capabilityStatus !== 'PRODUCTION_VALIDATED') return false;
    if (binding.sideEffectValidated !== true) return false;
    if (!binding.idempotencyKey || !binding.providerReadback) return false;
  }
  if (requiresFormalApproval(tool) && !dependencies.approvalStore) return false;
  return true;
}

function requireIdentity(
  dependencies: Pick<TocaCoreSurfaceDependencies, 'resolveIdentity'>,
  context: Parameters<ExecutionIdentityResolver>[0],
): ExecutionIdentity {
  const identity = dependencies.resolveIdentity(context);
  if (!identity) throw new Error('CORE_IDENTITY_REQUIRED');
  return identity;
}

function requireMutationRole(identity: ExecutionIdentity): void {
  if (!identity.authorization.roles.some((role) => role === 'OPERATOR' || role === 'ADMIN')) {
    throw new Error('CORE_MUTATION_ROLE_REQUIRED');
  }
}

function assertTenant(tenantId: string, identity: ExecutionIdentity): void {
  if (tenantId !== identity.principal.tenantId) throw new Error('CORE_TENANT_ACCESS_DENIED');
}

function assertWorkflowHumanTask(snapshot: WorkflowSnapshot, taskId: string): void {
  if (!snapshot.humanTasks.some((task) => task.taskId === taskId)) {
    throw new Error('WORKFLOW_HUMAN_TASK_WORKFLOW_MISMATCH');
  }
}

async function requireTenantWorkflow(
  store: WorkflowStore,
  workflowId: string,
  identity: ExecutionIdentity,
): Promise<WorkflowSnapshot> {
  const snapshot = await store.get(workflowId);
  if (!snapshot) throw new Error('WORKFLOW_NOT_FOUND');
  assertTenant(snapshot.instance.tenantId, identity);
  return snapshot;
}

function deterministicWorkflowId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\u0000${idempotencyKey}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `wf_${digest}`;
}

function normalizeEvidence(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function requireStore<T>(value: T | undefined, errorCode: string): T {
  if (!value) throw new Error(errorCode);
  return value;
}

function response(output: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    structuredContent: output as Record<string, unknown>,
  };
}
