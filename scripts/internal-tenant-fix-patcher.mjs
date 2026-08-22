import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`PATCH_SOURCE_NOT_FOUND:${path}:${before.slice(0, 80)}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`PATCH_SOURCE_NOT_UNIQUE:${path}:${before.slice(0, 80)}`);
  }
  writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length));
}

function replaceAllExact(path, before, after, minimum = 1) {
  const source = readFileSync(path, 'utf8');
  const parts = source.split(before);
  const count = parts.length - 1;
  if (count < minimum) throw new Error(`PATCH_SOURCE_COUNT:${path}:${count}<${minimum}`);
  writeFileSync(path, parts.join(after));
}

replaceOnce(
  'src/scheduler/postgres-scheduler.ts',
  `  return {\n    id: row.id,\n    toolName: row.tool_name,`,
  `  return {\n    id: row.id,\n    tenantId: row.tenant_id,\n    toolName: row.tool_name,`,
);

replaceOnce(
  'src/worker/worker-runtime.ts',
  `export interface WorkerRuntimeOptions {\n  readonly pool: pg.Pool;\n  readonly handlers: ReadonlyMap<string, JobHandler>;`,
  `export interface WorkerRuntimeOptions {\n  readonly pool: pg.Pool;\n  readonly tenantId: string;\n  readonly handlers: ReadonlyMap<string, JobHandler>;`,
);
replaceOnce(
  'src/worker/worker-runtime.ts',
  `    scheduler: new PostgresScheduler(options.pool),\n    handlers: new MapJobHandlerRegistry(options.handlers),\n    deadLetters: new PostgresDeadLetterSink(options.pool),`,
  `    scheduler: new PostgresScheduler(options.pool, options.tenantId),\n    handlers: new MapJobHandlerRegistry(options.handlers),\n    deadLetters: new PostgresDeadLetterSink(options.pool, options.tenantId),`,
);

replaceOnce(
  'src/worker/toca-managed-instagram-worker-runtime.ts',
  `export interface TocaManagedInstagramWorkerRuntimeOptions {\n  readonly config: RuntimeConfig;\n  readonly pool: pg.Pool;`,
  `export interface TocaManagedInstagramWorkerRuntimeOptions {\n  readonly config: RuntimeConfig;\n  readonly pool: pg.Pool;\n  readonly tenantId: string;`,
);
replaceOnce(
  'src/worker/toca-managed-instagram-worker-runtime.ts',
  `  return runWorkerBatch({\n    pool: options.pool,\n    handlers,`,
  `  return runWorkerBatch({\n    pool: options.pool,\n    tenantId: options.tenantId,\n    handlers,`,
);

replaceOnce(
  'src/worker/instagram-publication-worker-runtime.ts',
  `export interface InstagramPublicationWorkerRuntimeOptions {\n  readonly config: RuntimeConfig;\n  readonly pool: pg.Pool;\n}`,
  `export interface InstagramPublicationWorkerRuntimeOptions {\n  readonly config: RuntimeConfig;\n  readonly pool: pg.Pool;\n  readonly tenantId: string;\n}`,
);
replaceOnce(
  'src/worker/instagram-publication-worker-runtime.ts',
  `  return runWorkerBatch({\n    pool: options.pool,\n    handlers,`,
  `  return runWorkerBatch({\n    pool: options.pool,\n    tenantId: options.tenantId,\n    handlers,`,
);

replaceOnce(
  'src/instagram-publication-worker.ts',
  `const config = loadConfig(process.env);\nconst manualWorkerEnabled = config.INSTAGRAM_PUBLICATION_WRITES_ENABLED;`,
  `const config = loadConfig(process.env);\nconst tenantId = process.env.TOCA_DEFAULT_TENANT_ID?.trim() || 'toca';\nconst manualWorkerEnabled = config.INSTAGRAM_PUBLICATION_WRITES_ENABLED;`,
);
replaceOnce(
  'src/instagram-publication-worker.ts',
  `      const claimed = await runTocaManagedInstagramWorkerBatch({ config, pool });`,
  `      const claimed = await runTocaManagedInstagramWorkerBatch({ config, pool, tenantId });`,
);
replaceOnce(
  'src/instagram-publication-worker.ts',
  `      const claimed = await runInstagramPublicationWorkerBatch({ config, pool });`,
  `      const claimed = await runInstagramPublicationWorkerBatch({ config, pool, tenantId });`,
);

replaceOnce(
  'src/toca-managed-instagram-daemon.ts',
  `const config = loadConfig(process.env);\nconst port = Number.parseInt(process.env.PORT ?? '8080', 10);`,
  `const config = loadConfig(process.env);\nconst tenantId = process.env.TOCA_DEFAULT_TENANT_ID?.trim() || 'toca';\nconst port = Number.parseInt(process.env.PORT ?? '8080', 10);`,
);
replaceOnce(
  'src/toca-managed-instagram-daemon.ts',
  `  const scheduler = new TocaManagedInstagramScheduler(new PostgresScheduler(pool));`,
  `  const scheduler = new TocaManagedInstagramScheduler(new PostgresScheduler(pool, tenantId));`,
);
replaceOnce(
  'src/toca-managed-instagram-daemon.ts',
  `    lastClaimed = await runTocaManagedInstagramWorkerBatch({ config, pool, telemetry, logger });`,
  `    lastClaimed = await runTocaManagedInstagramWorkerBatch({\n      config,\n      pool,\n      tenantId,\n      telemetry,\n      logger,\n    });`,
);
replaceOnce(
  'src/toca-managed-instagram-daemon.ts',
  `      await pool.query('delete from scheduled_jobs where id = any($1::text[])', [jobIds]);`,
  `      await pool.query(\n        'delete from scheduled_jobs where id = any($1::text[]) and tenant_id = $2',\n        [jobIds, tenantId],\n      );`,
);

replaceOnce(
  'src/toca-managed-instagram-schedule-command.ts',
  `const pool = createPostgresPool({ connectionString: config.DATABASE_URL });\ntry {\n  const scheduler = new TocaManagedInstagramScheduler(new PostgresScheduler(pool));`,
  `const pool = createPostgresPool({ connectionString: config.DATABASE_URL });\nconst tenantId = process.env.TOCA_DEFAULT_TENANT_ID?.trim() || 'toca';\ntry {\n  const scheduler = new TocaManagedInstagramScheduler(new PostgresScheduler(pool, tenantId));`,
);

replaceOnce(
  'src/orchestrator/production-runtime.ts',
  `  const deadLetters = new PostgresDeadLetterSink(pool);`,
  `  const deadLetters = new PostgresDeadLetterSink(pool, config.tenantId);`,
);

replaceOnce(
  'src/server.ts',
  `  const instagramScheduler =\n    config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED && pool\n      ? new TocaManagedInstagramScheduler(new PostgresScheduler(pool))\n      : undefined;`,
  `  const instagramScheduler =\n    config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED && pool\n      ? (tenantId: string) =>\n          new TocaManagedInstagramScheduler(new PostgresScheduler(pool, tenantId))\n      : undefined;`,
);

replaceOnce(
  'src/mcp/runtime-capability-resolver.ts',
  `import type {\n  CoreCapabilityRuntimeBinding,\n  CoreCapabilityRuntimeResolver,\n} from './core-execution.js';`,
  `import type {\n  CoreCapabilityRuntimeBinding,\n  CoreCapabilityRuntimeContext,\n  CoreCapabilityRuntimeResolver,\n} from './core-execution.js';`,
);
replaceOnce(
  'src/mcp/runtime-capability-resolver.ts',
  `  readonly instagramScheduler?: TocaManagedInstagramScheduler;`,
  `  readonly instagramScheduler?: (tenantId: string) => TocaManagedInstagramScheduler;`,
);
replaceOnce(
  'src/mcp/runtime-capability-resolver.ts',
  `    case 'instagram.toca_schedule.create':\n      return services.instagramScheduler\n        ? binding(\n            tocaManagedInstagramSchedulePayloadSchema,\n            (input) => services.instagramScheduler!.schedule(input),\n            {\n              idempotencyKey: scheduleIdempotencyKey,\n              providerReadback: (result) =>\n                scheduleReadback(services.instagramScheduler!, result.id),\n              sideEffectValidated: true,\n            },\n          )\n        : undefined;\n    case 'instagram.toca_schedule.reschedule':\n      return services.instagramScheduler\n        ? binding(\n            rescheduleSchema,\n            (input) => executeIdempotentReschedule(services.instagramScheduler!, input),\n            {\n              idempotencyKey: (input) =>\n                \`instagram:reschedule:\${input.jobId}:\${scheduleIdempotencyKey(input.replacement)}\`,\n              providerReadback: (result) =>\n                scheduleReadback(services.instagramScheduler!, result.id),\n              sideEffectValidated: true,\n            },\n          )\n        : undefined;\n    case 'instagram.toca_schedule.cancel':\n      return services.instagramScheduler\n        ? binding(jobIdSchema, (input) => services.instagramScheduler!.cancel(input.jobId), {\n            idempotencyKey: (input) => \`instagram:cancel:\${input.jobId}\`,\n            providerReadback: async (_result, input) => {\n              const job = await services.instagramScheduler!.status(input.jobId);\n              const verified = job?.status === 'CANCELED';\n              return {\n                verified,\n                evidence: [\n                  verified\n                    ? \`scheduler:job:\${input.jobId}:canceled\`\n                    : \`scheduler:job:\${input.jobId}:cancel-readback-mismatch\`,\n                ],\n                externalResourceId: input.jobId,\n                ...(!verified ? { reason: 'SCHEDULER_CANCEL_NOT_READ_BACK' } : {}),\n              };\n            },\n            sideEffectValidated: true,\n          })\n        : undefined;\n    case 'instagram.toca_schedule.status':\n      return services.instagramScheduler\n        ? binding(jobIdSchema, async (input) => ({\n            job: await services.instagramScheduler!.status(input.jobId),\n          }))\n        : undefined;\n    case 'instagram.toca_schedule.list':\n      return services.instagramScheduler\n        ? binding(z.object({}), async () => ({ jobs: await services.instagramScheduler!.list() }))\n        : undefined;`,
  `    case 'instagram.toca_schedule.create':\n      return services.instagramScheduler\n        ? binding(\n            tocaManagedInstagramSchedulePayloadSchema,\n            (input, context) => schedulerForContext(services, context).schedule(input),\n            {\n              idempotencyKey: scheduleIdempotencyKey,\n              providerReadback: (result) => scheduleReadback(services, result),\n              sideEffectValidated: true,\n            },\n          )\n        : undefined;\n    case 'instagram.toca_schedule.reschedule':\n      return services.instagramScheduler\n        ? binding(\n            rescheduleSchema,\n            (input, context) =>\n              executeIdempotentReschedule(schedulerForContext(services, context), input),\n            {\n              idempotencyKey: (input) =>\n                \`instagram:reschedule:\${input.jobId}:\${scheduleIdempotencyKey(input.replacement)}\`,\n              providerReadback: (result) => scheduleReadback(services, result),\n              sideEffectValidated: true,\n            },\n          )\n        : undefined;\n    case 'instagram.toca_schedule.cancel':\n      return services.instagramScheduler\n        ? binding(\n            jobIdSchema,\n            (input, context) => schedulerForContext(services, context).cancel(input.jobId),\n            {\n              idempotencyKey: (input) => \`instagram:cancel:\${input.jobId}\`,\n              providerReadback: async (result, input) => {\n                const tenantId = result?.tenantId?.trim();\n                const scheduler = tenantId ? services.instagramScheduler?.(tenantId) : undefined;\n                const job = scheduler ? await scheduler.status(input.jobId) : undefined;\n                const verified = job?.status === 'CANCELED';\n                return {\n                  verified,\n                  evidence: [\n                    verified\n                      ? \`scheduler:job:\${input.jobId}:canceled\`\n                      : \`scheduler:job:\${input.jobId}:cancel-readback-mismatch\`,\n                  ],\n                  externalResourceId: input.jobId,\n                  ...(!verified ? { reason: 'SCHEDULER_CANCEL_NOT_READ_BACK' } : {}),\n                };\n              },\n              sideEffectValidated: true,\n            },\n          )\n        : undefined;\n    case 'instagram.toca_schedule.status':\n      return services.instagramScheduler\n        ? binding(jobIdSchema, async (input, context) => ({\n            job: await schedulerForContext(services, context).status(input.jobId),\n          }))\n        : undefined;\n    case 'instagram.toca_schedule.list':\n      return services.instagramScheduler\n        ? binding(z.object({}), async (_input, context) => ({\n            jobs: await schedulerForContext(services, context).list(),\n          }))\n        : undefined;`,
);
replaceOnce(
  'src/mcp/runtime-capability-resolver.ts',
  `function binding<T, TResult>(\n  schema: z.ZodType<T>,\n  execute: (input: T) => Promise<TResult>,`,
  `function binding<T, TResult>(\n  schema: z.ZodType<T>,\n  execute: (input: T, context?: CoreCapabilityRuntimeContext) => Promise<TResult>,`,
);
replaceOnce(
  'src/mcp/runtime-capability-resolver.ts',
  `    execute: (input) => execute(input as T),`,
  `    execute: (input, context) => execute(input as T, context),`,
);
replaceOnce(
  'src/mcp/runtime-capability-resolver.ts',
  `function scheduleIdempotencyKey(input: TocaManagedInstagramSchedulePayload): string {\n  return \`internal:instagram:toca-managed:\${input.contentItemId}:\${hashTocaManagedInstagramApprovalDescriptor(input)}\`;\n}\n\nasync function executeIdempotentReschedule(`,
  `function scheduleIdempotencyKey(input: TocaManagedInstagramSchedulePayload): string {\n  return \`internal:instagram:toca-managed:\${input.contentItemId}:\${hashTocaManagedInstagramApprovalDescriptor(input)}\`;\n}\n\nfunction schedulerForContext(\n  services: RuntimeCapabilityServices,\n  context: CoreCapabilityRuntimeContext | undefined,\n): TocaManagedInstagramScheduler {\n  const tenantId = context?.identity.principal.tenantId?.trim();\n  if (!tenantId) throw new Error('SCHEDULER_RUNTIME_TENANT_CONTEXT_REQUIRED');\n  const resolve = services.instagramScheduler;\n  if (!resolve) throw new Error('SCHEDULER_RUNTIME_UNAVAILABLE');\n  return resolve(tenantId);\n}\n\nasync function executeIdempotentReschedule(`,
);
replaceOnce(
  'src/mcp/runtime-capability-resolver.ts',
  `async function scheduleReadback(scheduler: TocaManagedInstagramScheduler, jobId: string) {\n  const job = await scheduler.status(jobId);\n  const verified = job?.status === 'SCHEDULED';\n  return {\n    verified,\n    evidence: [\n      verified ? \`scheduler:job:\${jobId}:scheduled\` : \`scheduler:job:\${jobId}:readback-mismatch\`,\n    ],\n    externalResourceId: jobId,\n    ...(!verified ? { reason: 'SCHEDULER_JOB_NOT_READ_BACK_AS_SCHEDULED' } : {}),\n  };\n}`,
  `async function scheduleReadback(\n  services: RuntimeCapabilityServices,\n  result: { readonly id: string; readonly tenantId?: string },\n) {\n  const tenantId = result.tenantId?.trim();\n  const scheduler = tenantId ? services.instagramScheduler?.(tenantId) : undefined;\n  const job = scheduler ? await scheduler.status(result.id) : undefined;\n  const verified = job?.status === 'SCHEDULED';\n  return {\n    verified,\n    evidence: [\n      verified\n        ? \`scheduler:job:\${result.id}:scheduled\`\n        : \`scheduler:job:\${result.id}:readback-mismatch\`,\n    ],\n    externalResourceId: result.id,\n    ...(!verified ? { reason: 'SCHEDULER_JOB_NOT_READ_BACK_AS_SCHEDULED' } : {}),\n  };\n}`,
);

replaceAllExact(
  'test/foundation-worker-postgres-e2e.test.ts',
  `new PostgresScheduler(firstPool)`,
  `new PostgresScheduler(firstPool, 'toca')`,
  1,
);
replaceAllExact(
  'test/foundation-worker-postgres-e2e.test.ts',
  `new PostgresScheduler(secondPool)`,
  `new PostgresScheduler(secondPool, 'toca')`,
  1,
);
replaceAllExact(
  'test/foundation-worker-postgres-e2e.test.ts',
  `new PostgresScheduler(pool)`,
  `new PostgresScheduler(pool, 'toca')`,
  1,
);
replaceAllExact(
  'test/foundation-worker-postgres-e2e.test.ts',
  `new PostgresDeadLetterSink(pool)`,
  `new PostgresDeadLetterSink(pool, 'toca')`,
  1,
);
replaceOnce(
  'test/foundation-worker-postgres-e2e.test.ts',
  `          (id, original_job_id, tool_name, payload, attempts, last_error, failed_at)\n           values ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz)`,
  `          (id, original_job_id, tool_name, payload, attempts, last_error, failed_at, tenant_id)\n           values ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz, $8)`,
);
replaceOnce(
  'test/foundation-worker-postgres-e2e.test.ts',
  `          '2026-08-17T21:10:02.000Z',\n        ],`,
  `          '2026-08-17T21:10:02.000Z',\n          'toca',\n        ],`,
);

replaceAllExact(
  'test/r31-learning-postgres-e2e.test.ts',
  `new PostgresScheduler(pool)`,
  `new PostgresScheduler(pool, 'toca')`,
  1,
);

console.log('INTERNAL_TENANT_FIX_PATCHED');
