from pathlib import Path

path = Path('src/measurement/commerce-provider-boundary.ts')
text = path.read_text()


def replace(old: str, new: str, label: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f'PATCH_ANCHOR_MISSING:{label}')
    text = text.replace(old, new, 1)


replace(
    "import type { CrmCoreStore, CrmScope, OpportunityRecord } from '../crm/crm-records.js';\n",
    "import type { CrmCoreStore, CrmScope, OpportunityRecord } from '../crm/crm-records.js';\nimport type { LearningRecord, LearningRecordStore } from '../learning/store.js';\n",
    'learning-import',
)
replace(
    "        | 'AMBIGUOUS_OPPORTUNITY'\n        | 'CONTACT_OPPORTUNITY_MISMATCH';",
    "        | 'AMBIGUOUS_OPPORTUNITY'\n        | 'CONTACT_OPPORTUNITY_MISMATCH'\n        | 'EVENT_OPPORTUNITY_MISMATCH';",
    'resolution-reason',
)
replace(
    "  readonly confidence: 1;\n  readonly providerEvidenceRefs: readonly string[];\n  readonly feedback: MarketingSalesFeedbackSnapshot;",
    "  /** Confidence applies to provider-confirmed revenue, not causal attribution. */\n  readonly confidence: 1;\n  readonly attributionKnown: boolean;\n  readonly providerEvidenceRefs: readonly string[];\n  readonly feedback: MarketingSalesFeedbackSnapshot;\n  readonly learningRecord: LearningRecord;",
    'feedback-contract',
)
replace(
    "    private readonly crm: CrmCoreStore,\n    private readonly attributionRevenue: AttributionRevenueService,\n  ) {}",
    "    private readonly crm: CrmCoreStore,\n    private readonly attributionRevenue: AttributionRevenueService,\n    private readonly learning?: LearningRecordStore,\n  ) {}",
    'constructor-learning',
)
old_return = """    return {
      outcome: 'WON',
      opportunityId: result.opportunity.opportunityId,
      revenueMinor: result.feedback.marketing.revenueMinor,
      currency: result.feedback.marketing.currency,
      campaign: result.feedback.sales.campaign,
      content: result.feedback.sales.creative ?? result.feedback.sales.message,
      confidence: 1,
      providerEvidenceRefs: [providerEvidenceRef],
      feedback: result.feedback,
    };
"""
new_return = """    if (!this.learning) throw new Error('COMMERCE_R31_LEARNING_STORE_REQUIRED');
    const campaign = result.feedback.sales.campaign;
    const content = result.feedback.sales.creative ?? result.feedback.sales.message;
    const attributionKnown = Boolean(campaign || content || result.feedback.sales.touchpointId);
    const feedback = {
      outcome: 'WON' as const,
      opportunityId: result.opportunity.opportunityId,
      revenueMinor: result.feedback.marketing.revenueMinor,
      currency: result.feedback.marketing.currency,
      campaign,
      content,
      confidence: 1 as const,
      attributionKnown,
      providerEvidenceRefs: [providerEvidenceRef],
      feedback: result.feedback,
    };
    const learningIdempotencyKey = commerceIdempotencyKey(
      'learning',
      ingestion.readback,
      opportunity.opportunityId,
    );
    const learningRecord = await this.learning.append({
      recordId: `commerce-learning-${learningIdempotencyKey.slice(-40)}`,
      recordType: 'OBSERVATION',
      ...scopeFromContext(context),
      experimentId: null,
      idempotencyKey: learningIdempotencyKey,
      payload: {
        outcome: feedback.outcome,
        opportunityId: feedback.opportunityId,
        revenueMinor: feedback.revenueMinor,
        currency: feedback.currency,
        campaign: feedback.campaign,
        content: feedback.content,
        confidence: feedback.confidence,
        confidenceScope: 'PROVIDER_CONFIRMED_REVENUE',
        attributionKnown: feedback.attributionKnown,
        providerEvidenceRefs: feedback.providerEvidenceRefs,
      },
      createdAt: context.now ?? ingestion.readback.providerReadbackAt,
      executionId: context.executionId,
      correlationId: context.correlationId,
      actorPrincipalId: context.identity.principal.principalId,
      evidence: [...new Set([...context.evidence, providerEvidenceRef])],
    });

    return { ...feedback, learningRecord };
"""
replace(old_return, new_return, 'learning-append')
old_explicit = """    const explicitContactId = nullableText(readback.attribution.contactId);
    if (explicitContactId && explicitContactId !== opportunity.contactId) {
      return {
        status: 'UNMATCHED',
        reason: 'CONTACT_OPPORTUNITY_MISMATCH',
        contactId: explicitContactId,
      };
    }
    return { status: 'MATCHED', opportunity, matchedBy: 'OPPORTUNITY_ID' };
"""
new_explicit = """    const explicitContactId = nullableText(readback.attribution.contactId);
    if (explicitContactId && explicitContactId !== opportunity.contactId) {
      return {
        status: 'UNMATCHED',
        reason: 'CONTACT_OPPORTUNITY_MISMATCH',
        contactId: explicitContactId,
      };
    }
    const explicitEventId = nullableText(readback.attribution.eventId);
    if (explicitEventId && explicitEventId !== opportunity.eventId) {
      return {
        status: 'UNMATCHED',
        reason: 'EVENT_OPPORTUNITY_MISMATCH',
        contactId: opportunity.contactId,
      };
    }
    return { status: 'MATCHED', opportunity, matchedBy: 'OPPORTUNITY_ID' };
"""
replace(old_explicit, new_explicit, 'event-lineage')
replace(
    "  purpose: 'revenue' | 'touchpoint' | 'won' | 'feedback',",
    "  purpose: 'revenue' | 'touchpoint' | 'won' | 'feedback' | 'learning',",
    'learning-idempotency',
)
path.write_text(text)
