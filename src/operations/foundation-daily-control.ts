import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { RuntimeTelemetry } from '../core/observability.js';
import type { StructuredLogger } from '../core/structured-logger.js';
import { PostgresAuditSink } from '../persistence/postgres-audit-sink.js';
import { PostgresOperationalObservabilityStore } from '../persistence/postgres-operational-observability.js';
import { createToolRegistry } from '../registry.js';

const CONTROL_NAME = 'foundation.daily_control.completed';
const TIME_ZONE = 'America/Bahia';
const START_HOUR = 8;
const OUTBOX_AGE_OBJECTIVE_SECONDS = 300;
const STALE_JOB_MINUTES = 10;
const MAX_AUDIT_EXECUTIONS = 100;

export interface FoundationDailyControlSnapshot {
  readonly dayKey: string;
  readonly checkedAt: string;
  readonly outboxPending: number;
  readonly oldestOutboxAgeSeconds: number;
  readonly staleRunningJobs: number;
  readonly auditExecutionsChecked: number;
  readonly invalidAuditExecutions: number;
}

export interface FoundationDailyControlFinding {
  readonly code: 'OUTBOX_STALLED' | 'STALE_SCHEDULER_JOBS' | 'AUDIT_LEDGER_INTEGRITY_FAILED';
  readonly severity: 'P0' | 'P1';
  readonly evidence: readonly string[];
}

export interface FoundationDailyControlResult {
  readonly ran: boolean;
  readonly dayKey: string;
  readonly healthy: boolean | null;
  readonly snapshot?: FoundationDailyControlSnapshot;
  readonly findings: readonly FoundationDailyControlFinding[];
  readonly reason?: 'BEFORE_DAILY_WINDOW' | 'ALREADY_COMPLETED';
}

interface CountRow {
  readonly count: string | number;
}

interface OutboxRow {
  readonly pending_count: string | number;
  readonly oldest_age_seconds: string | number | null;
}

interface AuditHeadRow {
  readonly execution_id: string;
}

export async function runFoundationDailyControl(input: {
  readonly pool: pg.Pool;
  readonly telemetry: RuntimeTelemetry;
  readonly logger: StructuredLogger;
  readonly now?: Date;
}): Promise<FoundationDailyControlResult> {
  const now = input.now ?? new Date();
  const clock = bahiaClock(now);
  if (clock.hour < START_HOUR) {
    return {
      ran: false,
      dayKey: clock.dayKey,
      healthy: null,
      findings: [],
      reason: 'BEFORE_DAILY_WINDOW',
    };
  }

  let alreadyCompleted: pg.QueryResult<{ exists: boolean }>;
  try {
    alreadyCompleted = await input.pool.query<{ exists: boolean }>(
      `select exists (
         select 1 from operational_signals
         where name = $1 and attributes->>'dayKey' = $2
       ) as exists`,
      [CONTROL_NAME, clock.dayKey],
    );
  } catch (error) {
    input.telemetry.increment('foundation.daily_control.failed');
    input.logger.error('foundation.daily_control.failed', {
      dayKey: clock.dayKey,
      phase: 'COMPLETION_READ',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  if (alreadyCompleted.rows[0]?.exists) {
    return {
      ran: false,
      dayKey: clock.dayKey,
      healthy: null,
      findings: [],
      reason: 'ALREADY_COMPLETED',
    };
  }

  input.telemetry.increment('foundation.daily_control.started');
  const started = Date.now();
  try {
    const [outbox, staleJobs, auditHeads] = await Promise.all([
      input.pool.query<OutboxRow>(
        `select
           count(*)::int as pending_count,
           coalesce(greatest(0, extract(epoch from (now() - min(occurred_at)))), 0)::float8
             as oldest_age_seconds
         from event_outbox
         where status in ('PENDING', 'CLAIMED', 'FAILED_RETRYABLE')`,
      ),
      input.pool.query<CountRow>(
        `select count(*)::int as count
         from scheduled_jobs
         where status = 'RUNNING'
           and updated_at < now() - interval '${STALE_JOB_MINUTES} minutes'`,
      ),
      input.pool.query<AuditHeadRow>(
        `select execution_id
         from audit_ledger_heads
         where updated_at >= now() - interval '24 hours'
         order by updated_at desc, execution_id asc
         limit $1`,
        [MAX_AUDIT_EXECUTIONS],
      ),
    ]);

    const auditVerifier = new PostgresAuditSink(input.pool, createToolRegistry());
    let invalidAuditExecutions = 0;
    for (const row of auditHeads.rows) {
      const verification = await auditVerifier.verifyExecution(row.execution_id);
      if (!verification.valid) invalidAuditExecutions += 1;
    }

    const snapshot: FoundationDailyControlSnapshot = {
      dayKey: clock.dayKey,
      checkedAt: now.toISOString(),
      outboxPending: integer(outbox.rows[0]?.pending_count),
      oldestOutboxAgeSeconds: finite(outbox.rows[0]?.oldest_age_seconds),
      staleRunningJobs: integer(staleJobs.rows[0]?.count),
      auditExecutionsChecked: auditHeads.rows.length,
      invalidAuditExecutions,
    };
    const findings = classifyFoundationDailyControl(snapshot);
    const healthy = findings.length === 0;

    const client = await input.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `foundation-daily-control:${clock.dayKey}`,
      ]);
      const completion = await client.query<{ exists: boolean }>(
        `select exists (
           select 1 from operational_signals
           where name = $1 and attributes->>'dayKey' = $2
         ) as exists`,
        [CONTROL_NAME, clock.dayKey],
      );
      if (!completion.rows[0]?.exists) {
        const signals = new PostgresOperationalObservabilityStore(input.pool);
        await signals.write(client, {
          signalId: randomUUID(),
          auditEventId: null,
          executionId: null,
          correlationId: `foundation:daily-control:${clock.dayKey}`,
          tenantId: null,
          signalType: 'STATE',
          name: CONTROL_NAME,
          value: healthy ? 1 : 0,
          attributes: {
            dayKey: clock.dayKey,
            healthy,
            outboxPending: snapshot.outboxPending,
            staleRunningJobs: snapshot.staleRunningJobs,
            invalidAuditExecutions: snapshot.invalidAuditExecutions,
          },
          evidence: [
            `foundation:daily-control:${clock.dayKey}`,
            `outbox:oldest-age-seconds:${snapshot.oldestOutboxAgeSeconds}`,
            `audit:checked:${snapshot.auditExecutionsChecked}`,
            ...findings.map((finding) => `finding:${finding.code}:${finding.severity}`),
          ],
          occurredAt: snapshot.checkedAt,
        });
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }

    input.telemetry.increment('foundation.daily_control.completed', {
      healthy: healthy ? 'true' : 'false',
    });
    input.telemetry.record(
      'foundation.daily_control.outbox_oldest_age_seconds',
      snapshot.oldestOutboxAgeSeconds,
    );
    input.telemetry.record(
      'foundation.daily_control.stale_running_jobs',
      snapshot.staleRunningJobs,
    );
    input.telemetry.record(
      'foundation.daily_control.invalid_audit_executions',
      snapshot.invalidAuditExecutions,
    );

    const fields = { snapshot, findings };
    if (healthy) input.logger.info('foundation.daily_control.completed', fields);
    else input.logger.error('foundation.daily_control.findings', fields);

    return { ran: true, dayKey: clock.dayKey, healthy, snapshot, findings };
  } catch (error) {
    input.telemetry.increment('foundation.daily_control.failed');
    input.logger.error('foundation.daily_control.failed', {
      dayKey: clock.dayKey,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    input.telemetry.record('foundation.daily_control.duration_ms', Date.now() - started);
  }
}

export function classifyFoundationDailyControl(
  snapshot: FoundationDailyControlSnapshot,
): readonly FoundationDailyControlFinding[] {
  const findings: FoundationDailyControlFinding[] = [];
  if (
    snapshot.outboxPending > 0 &&
    snapshot.oldestOutboxAgeSeconds > OUTBOX_AGE_OBJECTIVE_SECONDS
  ) {
    findings.push({
      code: 'OUTBOX_STALLED',
      severity: 'P1',
      evidence: [
        `pending:${snapshot.outboxPending}`,
        `oldest-age-seconds:${snapshot.oldestOutboxAgeSeconds}`,
      ],
    });
  }
  if (snapshot.staleRunningJobs > 0) {
    findings.push({
      code: 'STALE_SCHEDULER_JOBS',
      severity: 'P1',
      evidence: [`stale-running-jobs:${snapshot.staleRunningJobs}`],
    });
  }
  if (snapshot.invalidAuditExecutions > 0) {
    findings.push({
      code: 'AUDIT_LEDGER_INTEGRITY_FAILED',
      severity: 'P0',
      evidence: [
        `invalid:${snapshot.invalidAuditExecutions}`,
        `checked:${snapshot.auditExecutionsChecked}`,
      ],
    });
  }
  return findings;
}

export function foundationDailyControlDayKey(now: Date): string {
  return bahiaClock(now).dayKey;
}

function bahiaClock(now: Date): { dayKey: string; hour: number } {
  if (!Number.isFinite(now.getTime())) throw new Error('FOUNDATION_DAILY_CONTROL_DATE_INVALID');
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number.parseInt(parts.hour ?? '', 10),
  };
}

function integer(value: string | number | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '0', 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('FOUNDATION_DAILY_CONTROL_INTEGER_INVALID');
  return parsed;
}

function finite(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error('FOUNDATION_DAILY_CONTROL_NUMBER_INVALID');
  return parsed;
}
