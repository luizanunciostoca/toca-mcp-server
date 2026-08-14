import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { AuditSink } from '../core/audit.js';
import { executeTool } from '../core/executor.js';
import type { ToolDefinition, ToolRegistry } from '../core/tool-registry.js';
import {
  hashTocaManagedInstagramApprovalDescriptor,
  tocaManagedInstagramApprovalDescriptorSchema,
  tocaManagedInstagramSchedulePayloadSchema,
} from '../scheduler/toca-managed-instagram-scheduler.js';
import type { TocaManagedInstagramScheduler } from '../scheduler/toca-managed-instagram-scheduler.js';

const jobStatusSchema = z.enum(['SCHEDULED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED']);

const jobOutputSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  runAt: z.string(),
  timezone: z.string(),
  idempotencyKey: z.string(),
  status: jobStatusSchema,
  attempts: z.number().int(),
  lastError: z.string().optional(),
  payload: z.unknown(),
});

export interface InstagramManagedSchedulerExecutionOptions {
  readonly registry: ToolRegistry;
  readonly auditSink: AuditSink;
  readonly requester?: string;
}

export function registerInstagramManagedSchedulerTools(
  server: McpServer,
  scheduler: TocaManagedInstagramScheduler,
  execution: InstagramManagedSchedulerExecutionOptions,
): void {
  const requester = execution.requester ?? 'mcp-client';

  server.registerTool(
    'instagram.toca_schedule.prepare',
    {
      title: 'Prepare TOCA-managed Instagram Schedule',
      description:
        'Validate an immutable future-publication descriptor and return its SHA-256 for approval. This does not schedule or publish anything.',
      inputSchema: tocaManagedInstagramApprovalDescriptorSchema,
      outputSchema: z.object({ descriptorSha256: z.string().regex(/^[a-f0-9]{64}$/) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => response({ descriptorSha256: hashTocaManagedInstagramApprovalDescriptor(input) }),
  );

  server.registerTool(
    'instagram.toca_schedule.create',
    {
      title: 'Create TOCA-managed Instagram Schedule',
      description:
        'Persist an approved publication for future execution by the TOCA MCP scheduler. This creates an internal schedule only and does not call Meta during this request.',
      inputSchema: tocaManagedInstagramSchedulePayloadSchema,
      outputSchema: jobOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      response(
        await executeTool({
          tool: requireTool(execution.registry, 'instagram.toca_schedule.create'),
          policyContext: { requester },
          auditSink: execution.auditSink,
          correlationId: input.correlationId,
          action: () => scheduler.schedule(input),
        }),
      ),
  );

  server.registerTool(
    'instagram.toca_schedule.reschedule',
    {
      title: 'Reschedule TOCA-managed Instagram Publication',
      description:
        'Cancel the prior immutable schedule and create a replacement with a newly approved descriptor.',
      inputSchema: z.object({
        jobId: z.string().min(1),
        replacement: tocaManagedInstagramSchedulePayloadSchema,
      }),
      outputSchema: jobOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ jobId, replacement }) =>
      response(
        await executeTool({
          tool: requireTool(execution.registry, 'instagram.toca_schedule.reschedule'),
          policyContext: { requester },
          auditSink: execution.auditSink,
          correlationId: replacement.correlationId,
          action: () => scheduler.reschedule(jobId, replacement),
        }),
      ),
  );

  server.registerTool(
    'instagram.toca_schedule.cancel',
    {
      title: 'Cancel TOCA-managed Instagram Schedule',
      description: 'Cancel a future TOCA-managed publication before it is claimed for execution.',
      inputSchema: z.object({ jobId: z.string().min(1) }),
      outputSchema: z.object({ job: jobOutputSchema.optional() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ jobId }) => {
      const existing = await scheduler.status(jobId);
      const correlationId = existing?.payload.correlationId ?? `schedule-cancel:${jobId}`;
      return response({
        job: await executeTool({
          tool: requireTool(execution.registry, 'instagram.toca_schedule.cancel'),
          policyContext: { requester },
          auditSink: execution.auditSink,
          correlationId,
          action: () => scheduler.cancel(jobId),
        }),
      });
    },
  );

  server.registerTool(
    'instagram.toca_schedule.status',
    {
      title: 'Read TOCA-managed Instagram Schedule Status',
      description: 'Read one TOCA-managed schedule and its execution status.',
      inputSchema: z.object({ jobId: z.string().min(1) }),
      outputSchema: z.object({ job: jobOutputSchema.optional() }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ jobId }) => response({ job: await scheduler.status(jobId) }),
  );

  server.registerTool(
    'instagram.toca_schedule.list',
    {
      title: 'List TOCA-managed Instagram Schedules',
      description: 'List TOCA-managed Instagram publication jobs from the persistent scheduler.',
      inputSchema: z.object({}),
      outputSchema: z.object({ jobs: z.array(jobOutputSchema) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => response({ jobs: await scheduler.list() }),
  );
}

function requireTool(registry: ToolRegistry, name: string): ToolDefinition {
  const tool = registry.get(name);
  if (!tool) throw new Error(`MCP_TOOL_DEFINITION_NOT_FOUND:${name}`);
  return tool;
}

function response(output: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    structuredContent: output as Record<string, unknown>,
  };
}
