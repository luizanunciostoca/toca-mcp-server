import { describe, expect, it } from 'vitest';
import type { Experiment, ObservationRecord, Outcome } from '../src/learning/contracts.js';
import { createPostgresPool } from '../src/persistence/postgres.js';
import { PostgresR31LearningStore } from '../src/persistence/postgres-r31-learning-store.js';
import { PostgresScheduler } from '../src/scheduler/postgres-scheduler.js';
import {
  MarketingAutopilotR31Handler,
  R31_LEARNING_TOOL_NAME,
} from '../src/worker/marketing-autopilot-r31-handler.js';
import { runWorkerBatch } from '../src/worker/worker-runtime.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;
const TENANT_ID = 'tenant-r31';

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('R31_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('Marketing Autopilot R31 PostgreSQL E2E', () => {
  it('runs through the existing worker and remains idempotent across a fresh runtime', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const executionId = `r31-execution-${suffix}`;
    const correlationId = `r31-correlation-${suffix}`;
    const experimentId = `r31-experiment-${suffix}`;
    const payload = buildPayload({ executionId, correlationId, experimentId, suffix });
    const firstJobId = `r31-job-first-${suffix}`;
    const secondJobId = `r31-job-second-${suffix}`;
    const firstPool = createPostgresPool({ connectionString: databaseUrl(), max: 3 });

    try {
      const scheduler = new PostgresScheduler(firstPool, TENANT_ID);
      await scheduler.schedule({
        id: firstJobId,
        toolName: R31_LEARNING_TOOL_NAME,
        payload,
        runAt: '2026-08-20T04:00:00.000Z',
        timezone: 'America/Bahia',
        idempotencyKey: `scheduler:first:${suffix}`,
      });
      const handler = new MarketingAutopilotR31Handler({
        store: new PostgresR31LearningStore(firstPool),
      });
      const claimed = await runWorkerBatch({
        pool: firstPool,
        tenantId: TENANT_ID,
        handlers: new Map([[R31_LEARNING_TOOL_NAME, handler]]),
        claimToolName: R31_LEARNING_TOOL_NAME,
      });
      expect(claimed).toBe(1);
      expect(await scheduler.get(firstJobId)).toMatchObject({ status: 'SUCCEEDED' });
    } finally {
      await firstPool.end();
    }

    const secondPool = createPostgresPool({ connectionString: databaseUrl(), max: 3 });
    try {
      const scheduler = new PostgresScheduler(secondPool, TENANT_ID);
      await scheduler.schedule({
        id: secondJobId,
        toolName: R31_LEARNING_TOOL_NAME,
        payload,
        runAt: '2026-08-20T04:01:00.000Z',
        timezone: 'America/Bahia',
        idempotencyKey: `scheduler:duplicate-delivery:${suffix}`,
      });
      const handler = new MarketingAutopilotR31Handler({
        store: new PostgresR31LearningStore(secondPool),
      });
      const claimed = await runWorkerBatch({
        pool: secondPool,
        tenantId: TENANT_ID,
        handlers: new Map([[R31_LEARNING_TOOL_NAME, handler]]),
        claimToolName: R31_LEARNING_TOOL_NAME,
      });
      expect(claimed).toBe(1);
      expect(await scheduler.get(secondJobId)).toMatchObject({ status: 'SUCCEEDED' });

      const records = await new PostgresR31LearningStore(secondPool).listByExperiment({
        workspaceId: 'workspace-r31',
        experimentId,
      });
      expect(records).toHaveLength(9);
      expect(records.filter((record) => record.recordType === 'RECOMMENDATION')).toHaveLength(1);
      const recommendation = records.find((record) => record.recordType === 'RECOMMENDATION');
      expect(recommendation?.payload).toMatchObject({
        factor: 'creative',
        claimType: 'CAUSAL',
        financialWriteAllowed: false,
      });

      const outbox = await secondPool.query<{ count: string }>(
        `select count(*)::text as count from event_outbox
         where correlation_id = $1 and event_type like 'r31.%'`,
        [correlationId],
      );
      expect(outbox.rows[0]?.count).toBe('9');

      const audit = await secondPool.query<{ count: string }>(
        'select count(*)::text as count from audit_ledger_events where execution_id = $1',
        [executionId],
      );
      expect(audit.rows[0]?.count).toBe('9');
    } finally {
      await cleanup(secondPool, {
        correlationId,
        firstJobId,
        secondJobId,
        experimentId,
      });
      await secondPool.end();
    }
  });
});

function buildPayload(input: {
  executionId: string;
  correlationId: string;
  experimentId: string;
  suffix: string;
}): Readonly<Record<string, unknown>> {
  const experiment: Experiment = {
    experimentId: input.experimentId,
    tenantId: TENANT_ID,
    workspaceId: 'workspace-r31',
    organizationId: 'org-r31',
    status: 'RUNNING',
    design: 'RANDOMIZED_HOLDOUT',
    hypothesis: {
      statement: 'Creative B improves conversion rate.',
      factor: 'creative',
      primaryMetricKey: 'conversion_rate',
      expectedDirection: 'INCREASE',
      rationale: 'Randomized creative comparison.',
    },
    variants: [
      {
        variantId: 'control',
        label: 'Control',
        isControl: true,
        factorValues: { creative: 'A' },
        allocationPercent: 50,
      },
      {
        variantId: 'variant-b',
        label: 'Variant B',
        isControl: false,
        factorValues: { creative: 'B' },
        allocationPercent: 50,
      },
    ],
    primaryMetric: {
      metricKey: 'conversion_rate',
      type: 'RATE',
      direction: 'HIGHER_IS_BETTER',
      guardrail: false,
    },
    secondaryMetrics: [],
    minimumSampleSizePerVariant: 100,
    minimumDistinctWindows: 2,
    confidenceThreshold: 0.95,
    holdout: { variantId: 'control', allocationPercent: 50 },
    stopConditions: [{ type: 'MAX_SAMPLE_PER_VARIANT', value: 1000 }],
    seedRecommendationId: null,
    startedAt: '2026-08-20T01:00:00.000Z',
    plannedEndAt: '2026-08-21T01:00:00.000Z',
  };
  const observations: readonly ObservationRecord[] = [
    {
      observationId: `observation-1-${input.suffix}`,
      tenantId: experiment.tenantId,
      workspaceId: experiment.workspaceId,
      organizationId: experiment.organizationId,
      subjectType: 'CONTENT',
      subjectId: `content-${input.suffix}`,
      factorValues: { creative: 'A/B' },
      measurementRefs: ['measurement:observation-1'],
      providerReadbackRefs: ['provider:observation-1'],
      occurredAt: '2026-08-20T02:00:00.000Z',
      observedAt: '2026-08-20T02:01:00.000Z',
    },
    {
      observationId: `observation-2-${input.suffix}`,
      tenantId: experiment.tenantId,
      workspaceId: experiment.workspaceId,
      organizationId: experiment.organizationId,
      subjectType: 'CONTENT',
      subjectId: `content-${input.suffix}`,
      factorValues: { creative: 'A/B' },
      measurementRefs: ['measurement:observation-2'],
      providerReadbackRefs: ['provider:observation-2'],
      occurredAt: '2026-08-20T03:00:00.000Z',
      observedAt: '2026-08-20T03:01:00.000Z',
    },
  ];
  const outcomes: readonly Outcome[] = [
    outcome(input.experimentId, `c1-${input.suffix}`, 'control', 'w1', 10),
    outcome(input.experimentId, `c2-${input.suffix}`, 'control', 'w2', 10),
    outcome(input.experimentId, `b1-${input.suffix}`, 'variant-b', 'w1', 25),
    outcome(input.experimentId, `b2-${input.suffix}`, 'variant-b', 'w2', 25),
  ];
  return {
    executionId: input.executionId,
    correlationId: input.correlationId,
    actorPrincipalId: 'ag-01',
    idempotencyKey: `r31-learning:${input.experimentId}`,
    evidence: ['route:R31', 'sop:marketing-autopilot-learning'],
    now: '2026-08-20T04:00:00.000Z',
    cycleEvidence: {
      creativeTruthRefs: ['creative-truth:artifact'],
      assetRefs: ['asset:master'],
      gateRefs: ['quality-gate:passed', 'policy-gate:passed'],
      approvalRefs: ['approval:approved'],
      scheduleOrPublishRefs: ['publication:readback'],
      providerReadbackRefs: ['provider:publication-readback'],
      measurementRefs: ['measurement:normalized'],
    },
    experiment,
    observations,
    outcomes,
  };
}

function outcome(
  experimentId: string,
  outcomeId: string,
  variantId: string,
  windowKey: string,
  numerator: number,
): Outcome {
  return {
    outcomeId,
    experimentId,
    variantId,
    windowKey,
    metrics: [
      {
        metricKey: 'conversion_rate',
        type: 'RATE',
        sampleSize: 50,
        numerator,
        denominator: 50,
      },
    ],
    measurementRefs: [`measurement:${outcomeId}`],
    providerReadbackRefs: [`provider:${outcomeId}`],
    lineage: { source: 'INDEPENDENT_PROVIDER_READBACK', recommendationIds: [] },
    measuredAt: '2026-08-20T03:30:00.000Z',
  };
}

async function cleanup(
  pool: ReturnType<typeof createPostgresPool>,
  input: {
    correlationId: string;
    firstJobId: string;
    secondJobId: string;
    experimentId: string;
  },
): Promise<void> {
  await pool.query('delete from event_outbox where correlation_id = $1', [input.correlationId]);
  await pool.query('delete from audit_events where correlation_id = $1', [input.correlationId]);
  await pool.query('delete from r31_learning_records where experiment_id = $1', [
    input.experimentId,
  ]);
  await pool.query('delete from dead_letter_jobs where original_job_id in ($1, $2)', [
    input.firstJobId,
    input.secondJobId,
  ]);
  await pool.query('delete from scheduled_jobs where id in ($1, $2)', [
    input.firstJobId,
    input.secondJobId,
  ]);
}
