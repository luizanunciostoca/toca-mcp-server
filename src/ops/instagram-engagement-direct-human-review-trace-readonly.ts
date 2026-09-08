import pg from 'pg';

const { Pool } = pg;

const ACTION_INTENTS = [
  'FAQ_OPERATIONAL',
  'EVENT_INFO',
  'TICKET_INFO',
  'LOCATION_HOURS',
  'GENERAL_SOCIAL',
  'COMMERCIAL_LEAD',
  'COMPLAINT',
  'REFUND',
  'LEGAL',
  'SAFETY_INCIDENT',
  'PRESS',
  'PUBLIC_FIGURE',
  'HARASSMENT_OR_THREAT',
  'UNKNOWN',
] as const;

const POLICY_REASONS = [
  'sensitive_personal_data',
  'thread_automation_blocked',
  'intent:COMPLAINT',
  'intent:REFUND',
  'intent:LEGAL',
  'intent:SAFETY_INCIDENT',
  'intent:PRESS',
  'intent:PUBLIC_FIGURE',
  'intent:HARASSMENT_OR_THREAT',
  'intent:UNKNOWN',
  'context_conflict',
  'classification_confidence_low',
  'commercial_lead_requires_handoff',
  'facts_not_verified',
  'engagement_writes_kill_switch',
  'verified_low_risk:FAQ_OPERATIONAL',
  'verified_low_risk:EVENT_INFO',
  'verified_low_risk:TICKET_INFO',
  'verified_low_risk:LOCATION_HOURS',
  'verified_low_risk:GENERAL_SOCIAL',
  'unknown_or_unclassified',
] as const;

const databaseUrl = requiredEnv('DATABASE_URL');
const tenantId = requiredEnv('INSTAGRAM_ENGAGEMENT_TENANT_ID');
const workspaceId = requiredEnv('INSTAGRAM_ENGAGEMENT_WORKSPACE_ID');
const organizationId = requiredEnv('INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID');
const traceAgeMinutes = boundedInteger(
  process.env.INSTAGRAM_ENGAGEMENT_TRACE_MAX_AGE_MINUTES,
  120,
  1,
  360,
);

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  const total = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from instagram_engagement_actions
      where tenant_id = $1
        and workspace_id = $2
        and organization_id = $3
        and channel = 'DIRECT'
        and status = 'HUMAN_REVIEW'
        and created_at >= now() - ($4::text || ' minutes')::interval`,
    [tenantId, workspaceId, organizationId, String(traceAgeMinutes)],
  );
  const humanReviewTotal = Number(total.rows[0]?.count ?? 0);

  const intentCounts = await pool.query<{ intent: string; count: string }>(
    `select intent, count(*)::text as count
       from instagram_engagement_actions
      where tenant_id = $1
        and workspace_id = $2
        and organization_id = $3
        and channel = 'DIRECT'
        and status = 'HUMAN_REVIEW'
        and created_at >= now() - ($4::text || ' minutes')::interval
      group by intent`,
    [tenantId, workspaceId, organizationId, String(traceAgeMinutes)],
  );
  const byIntent = new Map(intentCounts.rows.map((row) => [row.intent, Number(row.count)]));
  const knownIntentTotal = ACTION_INTENTS.reduce(
    (sum, intent) => sum + (byIntent.get(intent) ?? 0),
    0,
  );

  const reasonCounts = await pool.query<{ policy_reason: string; count: string }>(
    `select policy_reason, count(*)::text as count
       from instagram_engagement_actions
      where tenant_id = $1
        and workspace_id = $2
        and organization_id = $3
        and channel = 'DIRECT'
        and status = 'HUMAN_REVIEW'
        and created_at >= now() - ($4::text || ' minutes')::interval
      group by policy_reason`,
    [tenantId, workspaceId, organizationId, String(traceAgeMinutes)],
  );
  const byReason = new Map(
    reasonCounts.rows.map((row) => [row.policy_reason, Number(row.count)]),
  );
  const knownReasonTotal = POLICY_REASONS.reduce(
    (sum, reason) => sum + (byReason.get(reason) ?? 0),
    0,
  );

  console.log('DIRECT_HUMAN_REVIEW_TRACE_STATUS=PASS');
  console.log(`DIRECT_HUMAN_REVIEW_TRACE_WINDOW_MINUTES=${traceAgeMinutes}`);
  console.log(`DIRECT_HUMAN_REVIEW_TOTAL=${humanReviewTotal}`);
  for (const intent of ACTION_INTENTS) {
    console.log(`DIRECT_HUMAN_INTENT_${intent}=${byIntent.get(intent) ?? 0}`);
  }
  console.log(`DIRECT_HUMAN_INTENT_OTHER=${Math.max(0, humanReviewTotal - knownIntentTotal)}`);
  for (const reason of POLICY_REASONS) {
    console.log(
      `DIRECT_HUMAN_POLICY_REASON_${metricKey(reason)}=${byReason.get(reason) ?? 0}`,
    );
  }
  console.log(
    `DIRECT_HUMAN_POLICY_REASON_OTHER=${Math.max(0, humanReviewTotal - knownReasonTotal)}`,
  );
  console.log('READ_ONLY_TRACE=true');
  console.log('DATABASE_MUTATIONS=false');
  console.log('PROVIDER_CALLS=false');
  console.log('EXTERNAL_REPLY_WRITES=false');
  console.log('RAW_USER_DATA_LOGGED=false');
} finally {
  await pool.end();
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error('INSTAGRAM_ENGAGEMENT_TRACE_MAX_AGE_INVALID');
  }
  return value;
}

function metricKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
