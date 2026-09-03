import { createHash } from 'node:crypto';
import pg from 'pg';
import { classifySocialEngagement } from '../crm/social-engagement-classifier.js';
import { PostgresInstagramEngagementKnowledgeSource } from '../instagram-engagement/postgres-knowledge.js';

const { Pool } = pg;
const INBOUND_TYPE = 'instagram.engagement.inbound.v1';
const AUTO_ELIGIBLE = new Set([
  'FAQ_OPERATIONAL',
  'EVENT_INFO',
  'TICKET_INFO',
  'LOCATION_HOURS',
  'GENERAL_SOCIAL',
]);

const databaseUrl = requiredEnv('DATABASE_URL');
const tenantId = requiredEnv('INSTAGRAM_ENGAGEMENT_TENANT_ID');
const workspaceId = requiredEnv('INSTAGRAM_ENGAGEMENT_WORKSPACE_ID');
const organizationId = requiredEnv('INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID');
const spreadsheetId = requiredEnv('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID');
const maxAgeMinutes = boundedInteger(
  process.env.INSTAGRAM_ENGAGEMENT_CANARY_MAX_AGE_MINUTES,
  30,
  1,
  60,
);
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

try {
  const candidates = await pool.query<{ event_id: string; payload: unknown }>(
    `select candidate.event_id, candidate.payload
       from event_outbox candidate
      where candidate.event_type = $1
        and candidate.tenant_id = $2
        and candidate.workspace_id = $3
        and candidate.organization_id = $4
        and candidate.status = 'PENDING'
        and candidate.attempts = 0
        and candidate.available_at <= now()
        and candidate.occurred_at >= now() - ($5::text || ' minutes')::interval
        and candidate.payload->>'channel' = 'DIRECT'
        and nullif(trim(candidate.payload->>'text'),'') is not null
        and nullif(trim(candidate.payload->>'senderId'),'') is not null
        and not exists (
          select 1
            from event_outbox nearby
           where nearby.event_type = $1
             and nearby.event_id <> candidate.event_id
             and nearby.tenant_id = candidate.tenant_id
             and nearby.workspace_id = candidate.workspace_id
             and nearby.organization_id = candidate.organization_id
             and nearby.payload->>'channel' = candidate.payload->>'channel'
             and nearby.payload->>'senderId' = candidate.payload->>'senderId'
             and nearby.occurred_at between candidate.occurred_at - interval '8 seconds'
                                         and candidate.occurred_at + interval '8 seconds'
        )
      order by candidate.occurred_at asc, candidate.event_id asc
      limit 100`,
    [INBOUND_TYPE, tenantId, workspaceId, organizationId, String(maxAgeMinutes)],
  );

  const knowledge = new PostgresInstagramEngagementKnowledgeSource(pool, spreadsheetId);
  const eligible: string[] = [];
  const rejected = {
    confidence: 0,
    priority: 0,
    sensitive: 0,
    commercial: 0,
    urgency: 0,
    intent: 0,
    knowledge: 0,
  };

  for (const row of candidates.rows) {
    const text = safeText(row.payload);
    if (!text) continue;
    const classification = classifySocialEngagement(text);
    if (classification.confidence !== 'HIGH') {
      rejected.confidence += 1;
      continue;
    }
    if (!['P2', 'P3'].includes(classification.priority)) {
      rejected.priority += 1;
      continue;
    }
    if (classification.containsPotentialSensitiveData) {
      rejected.sensitive += 1;
      continue;
    }
    if (classification.commercialIntent !== 'NONE') {
      rejected.commercial += 1;
      continue;
    }
    if (classification.urgency !== 'LOW') {
      rejected.urgency += 1;
      continue;
    }
    if (!AUTO_ELIGIBLE.has(classification.intent)) {
      rejected.intent += 1;
      continue;
    }
    const match = await knowledge.resolve(text, classification.intent);
    if (!match?.factsVerified || !match.faqId?.trim()) {
      rejected.knowledge += 1;
      continue;
    }
    eligible.push(digest(row.event_id));
  }

  const status =
    eligible.length === 0
      ? 'NO_ELIGIBLE_TARGET'
      : eligible.length === 1
        ? 'READY'
        : 'MULTIPLE_ELIGIBLE_TARGETS';

  console.log(`INSTAGRAM_ENGAGEMENT_CANARY_ELIGIBILITY=${status}`);
  console.log(`CANDIDATE_COUNT=${candidates.rowCount ?? candidates.rows.length}`);
  console.log(`ELIGIBLE_COUNT=${eligible.length}`);
  if (eligible.length === 1) console.log(`ELIGIBLE_TARGET_SHA256=${eligible[0]}`);
  console.log(`REJECTED_CONFIDENCE=${rejected.confidence}`);
  console.log(`REJECTED_PRIORITY=${rejected.priority}`);
  console.log(`REJECTED_SENSITIVE=${rejected.sensitive}`);
  console.log(`REJECTED_COMMERCIAL=${rejected.commercial}`);
  console.log(`REJECTED_URGENCY=${rejected.urgency}`);
  console.log(`REJECTED_INTENT=${rejected.intent}`);
  console.log(`REJECTED_KNOWLEDGE=${rejected.knowledge}`);
  console.log('READ_ONLY_ELIGIBILITY=true');
  console.log('DATABASE_MUTATIONS=false');
  console.log('PROVIDER_CALLS=false');
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
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error('INSTAGRAM_ENGAGEMENT_CANARY_MAX_AGE_INVALID');
  }
  return parsed;
}

function safeText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const text = (payload as Record<string, unknown>).text;
  return typeof text === 'string' && text.trim() ? text : null;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
