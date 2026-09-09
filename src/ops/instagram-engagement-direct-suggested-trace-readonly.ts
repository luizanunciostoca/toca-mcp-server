import pg from 'pg';

const { Pool } = pg;

const POLICY_REASONS = [
  'context_conflict',
  'classification_confidence_low',
  'commercial_lead_requires_handoff',
  'facts_not_verified',
  'engagement_writes_kill_switch',
  'unknown_or_unclassified',
  'verified_low_risk:FAQ_OPERATIONAL',
  'verified_low_risk:EVENT_INFO',
  'verified_low_risk:TICKET_INFO',
  'verified_low_risk:LOCATION_HOURS',
  'verified_low_risk:GENERAL_SOCIAL',
] as const;

const databaseUrl = requiredEnv('DATABASE_URL');
const tenantId = requiredEnv('INSTAGRAM_ENGAGEMENT_TENANT_ID');
const workspaceId = requiredEnv('INSTAGRAM_ENGAGEMENT_WORKSPACE_ID');
const organizationId = requiredEnv('INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID');
const traceAgeMinutes = boundedInteger(
  process.env.INSTAGRAM_ENGAGEMENT_TRACE_MAX_AGE_MINUTES,
  30,
  1,
  120,
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
        and status = 'SUGGESTED'
        and created_at >= now() - ($4::text || ' minutes')::interval`,
    [tenantId, workspaceId, organizationId, String(traceAgeMinutes)],
  );
  const suggestedTotal = Number(total.rows[0]?.count ?? 0);

  const reasonCounts = await pool.query<{ policy_reason: string; count: string }>(
    `select policy_reason, count(*)::text as count
       from instagram_engagement_actions
      where tenant_id = $1
        and workspace_id = $2
        and organization_id = $3
        and channel = 'DIRECT'
        and status = 'SUGGESTED'
        and created_at >= now() - ($4::text || ' minutes')::interval
      group by policy_reason`,
    [tenantId, workspaceId, organizationId, String(traceAgeMinutes)],
  );
  const byReason = new Map(reasonCounts.rows.map((row) => [row.policy_reason, Number(row.count)]));
  const knownReasonTotal = POLICY_REASONS.reduce(
    (sum, reason) => sum + (byReason.get(reason) ?? 0),
    0,
  );

  console.log('DIRECT_SUGGESTED_TRACE_STATUS=PASS');
  console.log(`DIRECT_SUGGESTED_TRACE_WINDOW_MINUTES=${traceAgeMinutes}`);
  console.log(`DIRECT_SUGGESTED_TOTAL=${suggestedTotal}`);
  for (const reason of POLICY_REASONS) {
    console.log(`DIRECT_SUGGESTED_POLICY_REASON_${metricKey(reason)}=${byReason.get(reason) ?? 0}`);
  }
  console.log(
    `DIRECT_SUGGESTED_POLICY_REASON_OTHER=${Math.max(0, suggestedTotal - knownReasonTotal)}`,
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

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error('INSTAGRAM_ENGAGEMENT_TRACE_MAX_AGE_INVALID');
  }
  return value;
}

function metricKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
