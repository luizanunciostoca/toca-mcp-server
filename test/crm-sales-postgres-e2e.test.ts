import { describe, expect, it } from 'vitest';
import { scoreLeadDeterministically } from '../src/crm/sales-engine.js';
import { PostgresCrmCoreStore } from '../src/persistence/postgres-crm-core-store.js';
import { PostgresCrmSalesStore } from '../src/persistence/postgres-crm-sales-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

const TENANT = 'crm-sales-e2e-tenant';
const WORKSPACE = 'crm-sales-e2e-workspace';
const ORGANIZATION = 'crm-sales-e2e-organization';
const PIPELINE = 'direct-sales';
const ACTOR = 'crm-sales:e2e';

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('CRM_SALES_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

function mutation(suffix: string, operation: string, now: string) {
  return {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    organizationId: ORGANIZATION,
    idempotencyKey: `${operation}-idempotency-${suffix}`,
    executionId: `${operation}-execution-${suffix}`,
    correlationId: `crm-sales-correlation-${suffix}`,
    actorPrincipalId: ACTOR,
    evidence: [`crm-sales:e2e:${operation}`],
    now,
  } as const;
}

postgresDescribe('CRM Sales Engine PostgreSQL E2E', () => {
  it('survives restart and closes lead -> opportunity -> WON idempotently', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const contactId = `contact-won-${suffix}`;
    const leadId = `lead-won-${suffix}`;
    const opportunityId = `opportunity-won-${suffix}`;
    const decisionId = `decision-won-${suffix}`;
    const scoreId = `score-won-${suffix}`;

    const pool1 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    const core1 = new PostgresCrmCoreStore(pool1);
    const sales1 = new PostgresCrmSalesStore(pool1);
    const contact = await core1.createContact({
      ...mutation(suffix, 'contact-create', '2026-08-20T12:00:00.000Z'),
      contactId,
      contactType: 'PERSON',
      displayName: 'Won Flow',
      channels: [
        {
          channelId: `email-won-${suffix}`,
          channelType: 'EMAIL',
          value: 'WON.TEST@example.com',
          verifiedAt: '2026-08-20T12:00:00.000Z',
          primary: true,
        },
      ],
    });
    expect(contact.contactId).toBe(contactId);
    const lead = await core1.createLead({
      ...mutation(suffix, 'lead-create', '2026-08-20T12:01:00.000Z'),
      leadId,
      contactId,
      sourceType: 'CAMPAIGN',
      sourceRef: 'campaign:crm-sales-e2e',
      capturedAt: '2026-08-20T12:01:00.000Z',
      attributes: { language: 'pt-BR' },
    });
    expect(lead.status).toBe('NEW');

    const resolution = await sales1.resolveContact({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      organizationId: ORGANIZATION,
      channels: [{ channelType: 'EMAIL', value: ' won.test@EXAMPLE.COM ' }],
    });
    expect(resolution).toMatchObject({ state: 'RESOLVED', canonicalContactId: contactId });

    await sales1.appendActivity({
      ...mutation(suffix, 'contacted', '2026-08-20T12:02:00.000Z'),
      activityId: `activity-contacted-${suffix}`,
      contactId,
      leadId,
      activityType: 'CONTACT_ATTEMPT',
      channel: 'EMAIL',
      summary: 'First response attempt',
      stageTransition: {
        pipelineKey: PIPELINE,
        fromStage: 'NEW',
        toStage: 'CONTACTED',
        reason: 'First governed contact attempt',
      },
    });

    const scoring = scoreLeadDeterministically({
      intentStrength: 4,
      urgency: 'IMMEDIATE',
      propensity: 0.95,
      estimatedValueMinor: 250_000,
      visitEventAt: '2026-08-21T20:00:00.000Z',
      engagementSignals: 5,
      now: '2026-08-20T12:03:00.000Z',
      aiScore: 40,
    });
    const qualified = await sales1.qualifyLead({
      ...mutation(suffix, 'qualify', '2026-08-20T12:03:00.000Z'),
      qualificationDecisionId: decisionId,
      leadScoreObservationId: scoreId,
      leadId,
      outcome: 'QUALIFIED',
      authority: 'DETERMINISTIC',
      scoring,
      intent: 'BOOK_EVENT',
      urgency: 'IMMEDIATE',
      propensity: 0.95,
      estimatedValueMinor: 250_000,
      currency: 'BRL',
      visitEventAt: '2026-08-21T20:00:00.000Z',
      campaignRef: 'campaign:crm-sales-e2e',
      sourceRef: 'email:e2e',
      rationale: 'Deterministic score exceeded the qualification threshold.',
      pipelineKey: PIPELINE,
      fromStage: 'CONTACTED',
    });
    expect(qualified).toMatchObject({ decision: 'QUALIFIED', leadId });

    const opportunity = await core1.createOpportunity({
      ...mutation(suffix, 'opportunity-create', '2026-08-20T12:04:00.000Z'),
      opportunityId,
      contactId,
      leadId,
      name: 'Won opportunity',
      pipelineKey: PIPELINE,
      stageKey: 'OPEN',
      currency: 'BRL',
      valueMinor: 250_000,
      ownerPrincipalId: ACTOR,
    });
    expect(opportunity.status).toBe('OPEN');
    await sales1.appendActivity({
      ...mutation(suffix, 'opportunity-stage', '2026-08-20T12:04:30.000Z'),
      activityId: `activity-opportunity-${suffix}`,
      contactId,
      leadId,
      opportunityId,
      activityType: 'QUALIFICATION',
      summary: 'Qualified lead converted to opportunity',
      stageTransition: {
        pipelineKey: PIPELINE,
        fromStage: 'QUALIFIED',
        toStage: 'OPPORTUNITY',
        reason: 'Commercial opportunity created',
      },
    });

    const won = await sales1.updateOpportunity({
      ...mutation(suffix, 'opportunity-won', '2026-08-20T12:05:00.000Z'),
      opportunityId,
      expectedVersion: opportunity.version,
      pipelineKey: PIPELINE,
      fromStage: 'OPPORTUNITY',
      toStage: 'WON',
      stageKey: 'WON',
      status: 'WON',
      valueMinor: 250_000,
      currency: 'BRL',
      reason: 'Customer accepted proposal',
    });
    expect(won.toStage).toBe('WON');
    await pool1.end();

    const pool2 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    try {
      const core2 = new PostgresCrmCoreStore(pool2);
      const sales2 = new PostgresCrmSalesStore(pool2);
      const persisted = await core2.getOpportunity({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        organizationId: ORGANIZATION,
        opportunityId,
      });
      expect(persisted).toMatchObject({ status: 'WON', lossReason: null });

      const replay = await sales2.updateOpportunity({
        ...mutation(suffix, 'opportunity-won', '2026-08-20T12:05:00.000Z'),
        opportunityId,
        expectedVersion: opportunity.version,
        pipelineKey: PIPELINE,
        fromStage: 'OPPORTUNITY',
        toStage: 'WON',
        stageKey: 'WON',
        status: 'WON',
        valueMinor: 250_000,
        currency: 'BRL',
        reason: 'Customer accepted proposal',
      });
      expect(replay).toEqual(won);

      const rows = await pool2.query<{ count: string }>(
        `select count(*)::text as count from crm_pipeline_stage_history
          where tenant_id=$1 and workspace_id=$2 and organization_id=$3
            and opportunity_id=$4 and to_stage='WON'`,
        [TENANT, WORKSPACE, ORGANIZATION, opportunityId],
      );
      expect(rows.rows[0]?.count).toBe('1');
      const auditRows = await pool2.query<{ count: string }>(
        `select count(*)::text as count from audit_ledger_events
          where tenant_id=$1 and workspace_id=$2 and organization_id=$3
            and tool_name='core.crm.sales.opportunity.updated' and external_resource_id=$4`,
        [TENANT, WORKSPACE, ORGANIZATION, opportunityId],
      );
      expect(Number(auditRows.rows[0]?.count ?? '0')).toBeGreaterThan(0);
      const outboxRows = await pool2.query<{ count: string }>(
        `select count(*)::text as count from event_outbox where aggregate_id=$1`,
        [opportunityId],
      );
      expect(Number(outboxRows.rows[0]?.count ?? '0')).toBeGreaterThan(0);
    } finally {
      await pool2.end();
    }
  });

  it('closes lead -> opportunity -> LOST with a mandatory reason', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const contactId = `contact-lost-${suffix}`;
    const leadId = `lead-lost-${suffix}`;
    const opportunityId = `opportunity-lost-${suffix}`;
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    try {
      const core = new PostgresCrmCoreStore(pool);
      const sales = new PostgresCrmSalesStore(pool);
      await core.createContact({
        ...mutation(suffix, 'lost-contact-create', '2026-08-20T13:00:00.000Z'),
        contactId,
        contactType: 'PERSON',
        displayName: 'Lost Flow',
      });
      await core.createLead({
        ...mutation(suffix, 'lost-lead-create', '2026-08-20T13:01:00.000Z'),
        leadId,
        contactId,
        sourceType: 'ORGANIC',
      });
      await sales.appendActivity({
        ...mutation(suffix, 'lost-contacted', '2026-08-20T13:02:00.000Z'),
        activityId: `lost-contacted-${suffix}`,
        contactId,
        leadId,
        activityType: 'CONTACT_ATTEMPT',
        summary: 'Contacted lead',
        stageTransition: {
          pipelineKey: PIPELINE,
          fromStage: 'NEW',
          toStage: 'CONTACTED',
          reason: 'Contact made',
        },
      });
      const scoring = scoreLeadDeterministically({
        intentStrength: 4,
        urgency: 'HIGH',
        propensity: 0.9,
        engagementSignals: 5,
        now: '2026-08-20T13:03:00.000Z',
      });
      await sales.qualifyLead({
        ...mutation(suffix, 'lost-qualify', '2026-08-20T13:03:00.000Z'),
        qualificationDecisionId: `lost-decision-${suffix}`,
        leadScoreObservationId: `lost-score-${suffix}`,
        leadId,
        outcome: 'QUALIFIED',
        authority: 'DETERMINISTIC',
        scoring,
        urgency: 'HIGH',
        propensity: 0.9,
        rationale: 'Qualified by deterministic rules',
        pipelineKey: PIPELINE,
        fromStage: 'CONTACTED',
      });
      const opportunity = await core.createOpportunity({
        ...mutation(suffix, 'lost-opportunity-create', '2026-08-20T13:04:00.000Z'),
        opportunityId,
        contactId,
        leadId,
        name: 'Lost opportunity',
        pipelineKey: PIPELINE,
        stageKey: 'OPEN',
      });
      await sales.appendActivity({
        ...mutation(suffix, 'lost-opportunity-stage', '2026-08-20T13:04:30.000Z'),
        activityId: `lost-opportunity-stage-${suffix}`,
        contactId,
        leadId,
        opportunityId,
        activityType: 'QUALIFICATION',
        summary: 'Opportunity created',
        stageTransition: {
          pipelineKey: PIPELINE,
          fromStage: 'QUALIFIED',
          toStage: 'OPPORTUNITY',
          reason: 'Opportunity created',
        },
      });
      await expect(
        sales.updateOpportunity({
          ...mutation(suffix, 'lost-without-reason', '2026-08-20T13:05:00.000Z'),
          opportunityId,
          expectedVersion: opportunity.version,
          pipelineKey: PIPELINE,
          fromStage: 'OPPORTUNITY',
          toStage: 'LOST',
          stageKey: 'LOST',
          status: 'LOST',
          reason: 'Attempted invalid close',
        }),
      ).rejects.toThrow('CRM_OPPORTUNITY_LOSS_REASON_REQUIRED');
      const lost = await sales.updateOpportunity({
        ...mutation(suffix, 'lost-close', '2026-08-20T13:05:30.000Z'),
        opportunityId,
        expectedVersion: opportunity.version,
        pipelineKey: PIPELINE,
        fromStage: 'OPPORTUNITY',
        toStage: 'LOST',
        stageKey: 'LOST',
        status: 'LOST',
        lossReason: 'PRICE_MISMATCH',
        reason: 'Customer declined on price',
      });
      expect(lost.toStage).toBe('LOST');
      expect(
        await core.getOpportunity({
          tenantId: TENANT,
          workspaceId: WORKSPACE,
          organizationId: ORGANIZATION,
          opportunityId,
        }),
      ).toMatchObject({
        status: 'LOST',
        lossReason: 'PRICE_MISMATCH',
      });
    } finally {
      await pool.end();
    }
  });

  it('moves an unready lead to NURTURE with immutable score and decision history', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const contactId = `contact-nurture-${suffix}`;
    const leadId = `lead-nurture-${suffix}`;
    const pool = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    try {
      const core = new PostgresCrmCoreStore(pool);
      const sales = new PostgresCrmSalesStore(pool);
      await core.createContact({
        ...mutation(suffix, 'nurture-contact-create', '2026-08-20T14:00:00.000Z'),
        contactId,
        contactType: 'PERSON',
        displayName: 'Nurture Flow',
      });
      await core.createLead({
        ...mutation(suffix, 'nurture-lead-create', '2026-08-20T14:01:00.000Z'),
        leadId,
        contactId,
        sourceType: 'SOCIAL',
      });
      await sales.appendActivity({
        ...mutation(suffix, 'nurture-contacted', '2026-08-20T14:02:00.000Z'),
        activityId: `nurture-contacted-${suffix}`,
        contactId,
        leadId,
        activityType: 'CONTACT_ATTEMPT',
        summary: 'Initial contact attempt',
        stageTransition: {
          pipelineKey: PIPELINE,
          fromStage: 'NEW',
          toStage: 'CONTACTED',
          reason: 'Initial attempt',
        },
      });
      const scoring = scoreLeadDeterministically({
        intentStrength: 1,
        urgency: 'LOW',
        propensity: 0.15,
        now: '2026-08-20T14:03:00.000Z',
        aiScore: 95,
      });
      const decision = await sales.qualifyLead({
        ...mutation(suffix, 'nurture-qualify', '2026-08-20T14:03:00.000Z'),
        qualificationDecisionId: `nurture-decision-${suffix}`,
        leadScoreObservationId: `nurture-score-${suffix}`,
        leadId,
        outcome: 'NURTURE',
        authority: 'DETERMINISTIC',
        scoring,
        urgency: 'LOW',
        propensity: 0.15,
        rationale: 'Deterministic score is below qualification threshold',
        pipelineKey: PIPELINE,
        fromStage: 'CONTACTED',
      });
      expect(decision.decision).toBe('NURTURE');
      expect(scoring.aiScore).toBe(95);
      expect(scoring.deterministicScore).toBeLessThan(35);
      expect(
        await core.getLead({
          tenantId: TENANT,
          workspaceId: WORKSPACE,
          organizationId: ORGANIZATION,
          leadId,
        }),
      ).toMatchObject({
        status: 'NURTURING',
        qualification: 'MARKETING_QUALIFIED',
      });
      const history = await pool.query<{ decisions: string; scores: string; nurture: string }>(
        `select
           (select count(*)::text from crm_qualification_decisions where lead_id=$1) as decisions,
           (select count(*)::text from crm_lead_score_observations where lead_id=$1) as scores,
           (select count(*)::text from crm_pipeline_stage_history where lead_id=$1 and to_stage='NURTURE') as nurture`,
        [leadId],
      );
      expect(history.rows[0]).toEqual({ decisions: '1', scores: '1', nurture: '1' });
      await expect(
        pool.query(`update crm_qualification_decisions set rationale='tampered' where lead_id=$1`, [
          leadId,
        ]),
      ).rejects.toThrow('CRM_SALES_HISTORY_MUTATION_FORBIDDEN');
    } finally {
      await pool.end();
    }
  });
});
