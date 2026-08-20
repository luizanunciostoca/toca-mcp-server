import { createHash } from 'node:crypto';
import type {
  ContactRecord,
  CrmCoreStore,
  CrmMutationMetadata,
  CrmScope,
  LeadRecord,
} from './crm-records.js';
import { classifySocialEngagement } from './social-engagement-classifier.js';
import type {
  SocialEngagementAuthorization,
  SocialEngagementClassification,
  SocialEngagementInteraction,
  SocialEngagementLeadInput,
  SocialEngagementLeadResult,
  SocialInteractionKind,
  SocialNextAction,
  SocialReplyDisposition,
} from './social-engagement-contracts.js';
import { SOCIAL_INTERACTION_KINDS } from './social-engagement-contracts.js';
import type { EventRecord, EventRecordStore } from '../events/event-record.js';
import { evaluateEngagementPolicy } from '../policy/engagement-policy.js';
import type {
  EngagementDecision,
  InstagramWebhookEvent,
} from '../providers/instagram/instagram-engagement-contracts.js';

type SocialCrmStore = Pick<
  CrmCoreStore,
  | 'findContactByChannel'
  | 'getContact'
  | 'createContact'
  | 'listLeadsForContact'
  | 'createLead'
  | 'updateLead'
>;

type SocialEventStore = Pick<EventRecordStore, 'get' | 'listBySeries'>;

export interface SocialEngagementLeadEngineOptions {
  readonly crm: SocialCrmStore;
  readonly events: SocialEventStore;
  readonly eventSeriesKeys: {
    readonly sunset: string;
    readonly theParty: string;
  };
}

const TERMINAL_LEAD_STATUSES = new Set<LeadRecord['status']>([
  'CONVERTED',
  'DISQUALIFIED',
  'ARCHIVED',
]);

export class SocialEngagementLeadEngine {
  constructor(private readonly options: SocialEngagementLeadEngineOptions) {}

  async process(input: SocialEngagementLeadInput): Promise<SocialEngagementLeadResult> {
    assertInteraction(input.interaction);
    const classification = classifySocialEngagement(input.interaction.text ?? '');
    const sensitive =
      input.authorization.containsSensitivePersonalData ??
      classification.containsPotentialSensitiveData;
    const policyDecision = evaluateEngagementPolicy({
      channel: input.interaction.kind === 'DIRECT' ? 'DIRECT' : 'COMMENT',
      intent: classification.intent,
      factsVerified: input.authorization.factsVerified,
      containsSensitivePersonalData: sensitive,
      writesEnabled: hasWriteAuthority(input.authorization),
    });

    if (!input.interaction.senderScopedId) {
      return unresolvedSenderResult(classification, policyDecision);
    }

    const contact = await this.resolveContact(input);
    const eventRecord = await this.resolveEventRecord(input, classification);
    const humanRequired =
      policyDecision.requiresHumanReview || classification.urgency === 'CRITICAL';
    const nextAction = resolveNextAction(classification, policyDecision, humanRequired);
    const replyDisposition = resolveReplyDisposition(
      policyDecision,
      input.authorization,
      humanRequired,
    );

    if (!isLeadWorthy(classification, humanRequired)) {
      return {
        classification,
        policyDecision,
        replyDisposition,
        nextAction,
        contact,
        eventRecord,
        lead: null,
        leadCreated: false,
        humanRequired,
      };
    }

    const socialLeadKey = createSocialLeadKey(contact.contactId, eventRecord, classification);
    const currentLeads = await this.options.crm.listLeadsForContact({
      ...scopeOf(input),
      contactId: contact.contactId,
      limit: 200,
    });
    const existingLead = currentLeads.find(
      (lead) =>
        !TERMINAL_LEAD_STATUSES.has(lead.status) && lead.attributes.socialLeadKey === socialLeadKey,
    );
    const score = scoreClassification(classification, humanRequired);
    const attributes = leadAttributes(
      socialLeadKey,
      input.interaction,
      classification,
      nextAction,
      humanRequired,
    );

    if (existingLead) {
      if (existingLead.attributes.lastEngagementEventId === input.interaction.interactionId) {
        return {
          classification,
          policyDecision,
          replyDisposition,
          nextAction,
          contact,
          eventRecord,
          lead: existingLead,
          leadCreated: false,
          humanRequired,
        };
      }
      const lead = await this.options.crm.updateLead({
        ...scopeOf(input),
        leadId: existingLead.leadId,
        expectedVersion: existingLead.version,
        score: Math.max(existingLead.score ?? 0, score),
        qualification:
          existingLead.qualification === 'UNQUALIFIED' && score >= 60
            ? 'MARKETING_QUALIFIED'
            : existingLead.qualification,
        attributes: { ...existingLead.attributes, ...attributes },
        ...mutationMetadata(input, `lead-update:${input.interaction.interactionId}`),
      });
      return {
        classification,
        policyDecision,
        replyDisposition,
        nextAction,
        contact,
        eventRecord,
        lead,
        leadCreated: false,
        humanRequired,
      };
    }

    const leadId = stableId('lead', [
      input.tenantId,
      input.workspaceId,
      input.organizationId,
      socialLeadKey,
    ]);
    const lead = await this.options.crm.createLead({
      ...scopeOf(input),
      leadId,
      contactId: contact.contactId,
      eventId: eventRecord?.eventId ?? null,
      sourceType: `SOCIAL_${input.interaction.kind}`,
      sourceRef: input.interaction.interactionId,
      status: humanRequired ? 'WORKING' : 'NEW',
      qualification: score >= 60 ? 'MARKETING_QUALIFIED' : 'UNQUALIFIED',
      score,
      capturedAt: input.interaction.occurredAt,
      attributes,
      ...mutationMetadata(input, `lead-create:${socialLeadKey}`),
    });

    return {
      classification,
      policyDecision,
      replyDisposition,
      nextAction,
      contact,
      eventRecord,
      lead,
      leadCreated: true,
      humanRequired,
    };
  }

  private async resolveContact(input: SocialEngagementLeadInput): Promise<ContactRecord> {
    const senderScopedId = input.interaction.senderScopedId;
    if (!senderScopedId) throw new Error('SOCIAL_ENGAGEMENT_SENDER_REQUIRED');
    const scope = scopeOf(input);
    const lookup = {
      ...scope,
      channelType: 'SOCIAL' as const,
      provider: input.interaction.provider,
      value: senderScopedId,
    };
    const found = await this.options.crm.findContactByChannel(lookup);
    if (found) return found;

    const contactId = stableId('contact', [
      input.tenantId,
      input.workspaceId,
      input.organizationId,
      input.interaction.provider,
      senderScopedId,
    ]);
    const existingById = await this.options.crm.getContact({ ...scope, contactId });
    if (existingById) return existingById;

    const channelId = stableId('channel', [contactId, input.interaction.provider, senderScopedId]);
    const displaySuffix = createHash('sha256').update(senderScopedId).digest('hex').slice(0, 8);
    try {
      return await this.options.crm.createContact({
        ...scope,
        contactId,
        contactType: 'PERSON',
        displayName: `Instagram contact ${displaySuffix}`,
        channels: [
          {
            channelId,
            channelType: 'SOCIAL',
            provider: input.interaction.provider,
            value: senderScopedId,
            primary: true,
          },
        ],
        attributes: {
          sourceProvider: input.interaction.provider,
          identityResolution: 'PROVIDER_SCOPED_ID',
        },
        ...mutationMetadata(input, `contact-create:${contactId}`),
      });
    } catch (error) {
      const raced = await this.options.crm.findContactByChannel(lookup);
      if (raced) return raced;
      throw error;
    }
  }

  private async resolveEventRecord(
    input: SocialEngagementLeadInput,
    classification: SocialEngagementClassification,
  ): Promise<EventRecord | null> {
    if (input.interaction.eventIdHint) {
      const hinted = await this.options.events.get(input.interaction.eventIdHint);
      if (hinted && sameScope(input, hinted)) return hinted;
      return null;
    }

    const seriesKey =
      classification.productEvent === 'SUNSET'
        ? this.options.eventSeriesKeys.sunset
        : classification.productEvent === 'THE_PARTY'
          ? this.options.eventSeriesKeys.theParty
          : null;
    if (!seriesKey) return null;

    const candidates = await this.options.events.listBySeries(input.tenantId, seriesKey, 100);
    const scoped = candidates.filter(
      (event) => sameScope(input, event) && !['CANCELED', 'ARCHIVED'].includes(event.status),
    );
    if (scoped.length === 0) return null;
    const interactionAt = Date.parse(input.interaction.occurredAt);
    return (
      [...scoped].sort((left, right) => {
        const leftDistance = Math.abs(Date.parse(left.startsAt) - interactionAt);
        const rightDistance = Math.abs(Date.parse(right.startsAt) - interactionAt);
        return leftDistance - rightDistance || left.eventId.localeCompare(right.eventId);
      })[0] ?? null
    );
  }
}

export function socialInteractionFromInstagramWebhook(
  event: InstagramWebhookEvent,
): SocialEngagementInteraction {
  if (!event.occurredAt) throw new Error('SOCIAL_ENGAGEMENT_OCCURRED_AT_REQUIRED');
  const rawType = event.rawType.toLowerCase();
  const kind: SocialInteractionKind =
    event.channel === 'DIRECT'
      ? 'DIRECT'
      : rawType.includes('mention')
        ? 'MENTION'
        : rawType.includes('reply')
          ? 'REPLY'
          : 'COMMENT';
  const providerObjectId = event.messageId ?? event.commentId ?? event.mediaId;
  return {
    interactionId: event.eventId,
    provider: 'instagram',
    kind,
    ...(event.senderId ? { senderScopedId: event.senderId } : {}),
    ...(event.text ? { text: event.text } : {}),
    occurredAt: event.occurredAt,
    ...(providerObjectId ? { providerObjectId } : {}),
  };
}

function unresolvedSenderResult(
  classification: SocialEngagementClassification,
  policyDecision: EngagementDecision,
): SocialEngagementLeadResult {
  return {
    classification,
    policyDecision,
    replyDisposition: 'HUMAN_REQUIRED',
    nextAction: 'HUMAN_REVIEW',
    contact: null,
    eventRecord: null,
    lead: null,
    leadCreated: false,
    humanRequired: true,
  };
}

function resolveReplyDisposition(
  decision: EngagementDecision,
  authorization: SocialEngagementAuthorization,
  humanRequired: boolean,
): SocialReplyDisposition {
  if (humanRequired) return 'HUMAN_REQUIRED';
  if (decision.autonomy === 'AUTO_REPLY_ALLOWED') {
    return hasWriteAuthority(authorization) ? 'AUTO_REPLY_ALLOWED' : 'SUGGEST_ONLY';
  }
  if (decision.autonomy === 'SUGGEST_ONLY') return 'SUGGEST_ONLY';
  return decision.autonomy === 'READ_ONLY' ? 'NO_REPLY' : 'HUMAN_REQUIRED';
}

function resolveNextAction(
  classification: SocialEngagementClassification,
  decision: EngagementDecision,
  humanRequired: boolean,
): SocialNextAction {
  if (humanRequired) return 'HUMAN_REVIEW';
  if (classification.commercialIntent === 'HIGH') return 'SALES_FOLLOW_UP';
  if (['TICKETS', 'RESERVATION', 'PRICE', 'EVENT_INFO'].includes(classification.topic)) {
    return 'RESPOND_WITH_VERIFIED_EVENT_INFO';
  }
  if (classification.topic === 'LOCATION_HOURS') return 'RESPOND_WITH_VERIFIED_OPERATIONAL_INFO';
  if (decision.autonomy === 'SUGGEST_ONLY') return 'SUGGEST_REPLY';
  return 'NO_ACTION';
}

function hasWriteAuthority(authorization: SocialEngagementAuthorization): boolean {
  return (
    authorization.writesEnabled &&
    authorization.consentAllowed &&
    (!authorization.approvalRequired || authorization.approvalSatisfied)
  );
}

function isLeadWorthy(
  classification: SocialEngagementClassification,
  humanRequired: boolean,
): boolean {
  return (
    humanRequired ||
    classification.commercialIntent !== 'NONE' ||
    classification.eventInterest !== 'NONE'
  );
}

function createSocialLeadKey(
  contactId: string,
  eventRecord: EventRecord | null,
  classification: SocialEngagementClassification,
): string {
  return createHash('sha256')
    .update(
      [contactId, eventRecord?.eventId ?? classification.productEvent, classification.topic].join(
        ':',
      ),
    )
    .digest('hex');
}

function scoreClassification(
  classification: SocialEngagementClassification,
  humanRequired: boolean,
): number {
  const commercial = { NONE: 0, LOW: 25, MEDIUM: 55, HIGH: 80 }[classification.commercialIntent];
  const urgency = { LOW: 0, MEDIUM: 5, HIGH: 10, CRITICAL: 10 }[classification.urgency];
  const event = classification.eventInterest === 'NONE' ? 0 : 5;
  return Math.min(100, commercial + urgency + event + (humanRequired ? 0 : 5));
}

function leadAttributes(
  socialLeadKey: string,
  interaction: SocialEngagementInteraction,
  classification: SocialEngagementClassification,
  nextAction: SocialNextAction,
  humanRequired: boolean,
): LeadRecord['attributes'] {
  return {
    socialLeadKey,
    intent: classification.intent,
    commercialIntent: classification.commercialIntent,
    eventInterest: classification.eventInterest,
    sentiment: classification.sentiment,
    urgency: classification.urgency,
    topic: classification.topic,
    language: classification.language,
    productEvent: classification.productEvent,
    nextAction,
    humanRequired,
    sourceProvider: interaction.provider,
    lastInteractionKind: interaction.kind,
    lastEngagementAt: interaction.occurredAt,
    lastEngagementEventId: interaction.interactionId,
  };
}

function mutationMetadata(input: SocialEngagementLeadInput, suffix: string): CrmMutationMetadata {
  return {
    idempotencyKey: `${input.idempotencyKey}:${suffix}`,
    executionId: input.executionId,
    correlationId: input.correlationId,
    actorPrincipalId: input.actorPrincipalId,
    evidence: input.evidence,
    ...(input.now ? { now: input.now } : {}),
  };
}

function scopeOf(input: CrmScope): CrmScope {
  return {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
  };
}

function sameScope(scope: CrmScope, event: EventRecord): boolean {
  return (
    event.tenantId === scope.tenantId &&
    event.workspaceId === scope.workspaceId &&
    event.organizationId === scope.organizationId
  );
}

function stableId(prefix: string, material: readonly string[]): string {
  const digest = createHash('sha256').update(material.join(':')).digest('hex').slice(0, 32);
  return `${prefix}_${digest}`;
}

function assertInteraction(interaction: SocialEngagementInteraction): void {
  if (!interaction.interactionId.trim()) throw new Error('SOCIAL_ENGAGEMENT_ID_REQUIRED');
  if (!SOCIAL_INTERACTION_KINDS.includes(interaction.kind)) {
    throw new Error('SOCIAL_ENGAGEMENT_KIND_INVALID');
  }
  if (!Number.isFinite(Date.parse(interaction.occurredAt))) {
    throw new Error('SOCIAL_ENGAGEMENT_OCCURRED_AT_INVALID');
  }
}
