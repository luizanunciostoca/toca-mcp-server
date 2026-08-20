import type { ContactRecord, CrmMutationMetadata, CrmScope, LeadRecord } from './crm-records.js';
import type { EventRecord } from '../events/event-record.js';
import type { EngagementDecision } from '../providers/instagram/instagram-engagement-contracts.js';
import type { EngagementIntent } from '../policy/engagement-policy.js';

export const SOCIAL_INTERACTION_KINDS = ['COMMENT', 'DIRECT', 'MENTION', 'REPLY'] as const;
export type SocialInteractionKind = (typeof SOCIAL_INTERACTION_KINDS)[number];

export type SocialCommercialIntent = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type SocialEventInterest = 'NONE' | 'SUNSET' | 'THE_PARTY' | 'BOTH';
export type SocialSentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
export type SocialUrgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SocialLanguage = 'PT' | 'EN' | 'ES' | 'UNKNOWN';
export type SocialTopic =
  | 'TICKETS'
  | 'RESERVATION'
  | 'PRICE'
  | 'EVENT_INFO'
  | 'LOCATION_HOURS'
  | 'COMPLAINT'
  | 'REFUND'
  | 'LEGAL'
  | 'SAFETY'
  | 'PRESS'
  | 'GENERAL';

export type SocialNextAction =
  | 'HUMAN_REVIEW'
  | 'SALES_FOLLOW_UP'
  | 'RESPOND_WITH_VERIFIED_EVENT_INFO'
  | 'RESPOND_WITH_VERIFIED_OPERATIONAL_INFO'
  | 'SUGGEST_REPLY'
  | 'NO_ACTION';

export type SocialReplyDisposition =
  'AUTO_REPLY_ALLOWED' | 'SUGGEST_ONLY' | 'HUMAN_REQUIRED' | 'NO_REPLY';

export interface SocialEngagementClassification {
  readonly intent: EngagementIntent;
  readonly commercialIntent: SocialCommercialIntent;
  readonly eventInterest: SocialEventInterest;
  readonly sentiment: SocialSentiment;
  readonly urgency: SocialUrgency;
  readonly topic: SocialTopic;
  readonly language: SocialLanguage;
  readonly productEvent: 'SUNSET' | 'THE_PARTY' | 'BOTH' | 'UNSPECIFIED';
  readonly containsPotentialSensitiveData: boolean;
}

export interface SocialEngagementInteraction {
  readonly interactionId: string;
  readonly provider: 'instagram';
  readonly kind: SocialInteractionKind;
  readonly senderScopedId?: string;
  readonly text?: string;
  readonly occurredAt: string;
  readonly providerObjectId?: string;
  readonly eventIdHint?: string;
}

export interface SocialEngagementAuthorization {
  readonly factsVerified: boolean;
  readonly writesEnabled: boolean;
  readonly consentAllowed: boolean;
  readonly approvalRequired: boolean;
  readonly approvalSatisfied: boolean;
  readonly containsSensitivePersonalData?: boolean;
}

export interface SocialEngagementLeadInput extends CrmScope, CrmMutationMetadata {
  readonly interaction: SocialEngagementInteraction;
  readonly authorization: SocialEngagementAuthorization;
}

export interface SocialEngagementLeadResult {
  readonly classification: SocialEngagementClassification;
  readonly policyDecision: EngagementDecision;
  readonly replyDisposition: SocialReplyDisposition;
  readonly nextAction: SocialNextAction;
  readonly contact: ContactRecord | null;
  readonly eventRecord: EventRecord | null;
  readonly lead: LeadRecord | null;
  readonly leadCreated: boolean;
  readonly humanRequired: boolean;
}
