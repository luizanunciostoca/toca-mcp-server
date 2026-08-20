import { describe, expect, it } from 'vitest';
import type { ContactRecord, LeadRecord } from '../src/crm/crm-records.js';
import { classifySocialEngagement } from '../src/crm/social-engagement-classifier.js';
import {
  SocialEngagementLeadEngine,
  socialInteractionFromInstagramWebhook,
  type SocialEngagementLeadEngineOptions,
} from '../src/crm/social-engagement-lead-engine.js';
import type { EventRecord } from '../src/events/event-record.js';
import { parseMetaWebhookEvents } from '../src/providers/meta/meta-webhook.js';

const NOW = '2026-08-20T05:30:00.000Z';

function createHarness(): {
  readonly engine: SocialEngagementLeadEngine;
  readonly contacts: Map<string, ContactRecord>;
  readonly leads: Map<string, LeadRecord>;
} {
  const contacts = new Map<string, ContactRecord>();
  const senderToContact = new Map<string, string>();
  const leads = new Map<string, LeadRecord>();
  const event: EventRecord = {
    eventId: 'event-sunset-20260820',
    eventKey: 'sunset-20260820',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    organizationId: 'org-1',
    seriesKey: 'SUNSET_SERIES',
    name: 'Sunset',
    eventType: 'SUNSET',
    status: 'CONFIRMED',
    startsAt: '2026-08-20T19:00:00.000Z',
    endsAt: '2026-08-20T23:00:00.000Z',
    timezone: 'America/Bahia',
    venueName: 'Toca do Morcego',
    attributes: {},
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const crm: SocialEngagementLeadEngineOptions['crm'] = {
    findContactByChannel: (input) => {
      const id = senderToContact.get(`${input.provider}:${input.value}`);
      return Promise.resolve(id ? contacts.get(id) : undefined);
    },
    getContact: (input) => Promise.resolve(contacts.get(input.contactId)),
    createContact: (input) => {
      const now = input.now ?? NOW;
      const record: ContactRecord = {
        contactId: input.contactId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        contactType: input.contactType,
        displayName: input.displayName,
        status: 'ACTIVE',
        attributes: input.attributes ?? {},
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      contacts.set(record.contactId, record);
      for (const channel of input.channels ?? []) {
        senderToContact.set(`${channel.provider ?? ''}:${channel.value}`, record.contactId);
      }
      return Promise.resolve(record);
    },
    listLeadsForContact: (input) =>
      Promise.resolve([...leads.values()].filter((lead) => lead.contactId === input.contactId)),
    createLead: (input) => {
      const now = input.now ?? NOW;
      const qualification = input.qualification ?? 'UNQUALIFIED';
      const status = input.status ?? 'NEW';
      const record: LeadRecord = {
        leadId: input.leadId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        contactId: input.contactId,
        eventId: input.eventId ?? null,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef ?? null,
        status,
        qualification,
        score: input.score ?? null,
        ownerPrincipalId: input.ownerPrincipalId ?? null,
        slaDueAt: input.slaDueAt ?? null,
        capturedAt: input.capturedAt ?? now,
        qualifiedAt: qualification === 'UNQUALIFIED' ? null : now,
        convertedAt: status === 'CONVERTED' ? now : null,
        disqualifiedReason: null,
        attributes: input.attributes ?? {},
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      leads.set(record.leadId, record);
      return Promise.resolve(record);
    },
    updateLead: (input) => {
      const current = leads.get(input.leadId);
      if (!current) return Promise.reject(new Error('TEST_LEAD_NOT_FOUND'));
      const next: LeadRecord = {
        ...current,
        status: input.status ?? current.status,
        qualification: input.qualification ?? current.qualification,
        score: input.score === undefined ? current.score : input.score,
        ownerPrincipalId:
          input.ownerPrincipalId === undefined ? current.ownerPrincipalId : input.ownerPrincipalId,
        slaDueAt: input.slaDueAt === undefined ? current.slaDueAt : input.slaDueAt,
        disqualifiedReason:
          input.disqualifiedReason === undefined
            ? current.disqualifiedReason
            : input.disqualifiedReason,
        attributes: input.attributes ?? current.attributes,
        version: current.version + 1,
        updatedAt: input.now ?? NOW,
      };
      leads.set(next.leadId, next);
      return Promise.resolve(next);
    },
  };

  const events: SocialEngagementLeadEngineOptions['events'] = {
    get: (eventId) => Promise.resolve(eventId === event.eventId ? event : undefined),
    listBySeries: (_tenantId, seriesKey) =>
      Promise.resolve(seriesKey === event.seriesKey ? [event] : []),
  };

  return {
    engine: new SocialEngagementLeadEngine({
      crm,
      events,
      eventSeriesKeys: { sunset: 'SUNSET_SERIES', theParty: 'THE_PARTY_SERIES' },
    }),
    contacts,
    leads,
  };
}

function input(interactionId: string, text: string) {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    organizationId: 'org-1',
    idempotencyKey: `idem-${interactionId}`,
    executionId: `exec-${interactionId}`,
    correlationId: `corr-${interactionId}`,
    actorPrincipalId: 'ag-01',
    evidence: [`meta-webhook:${interactionId}`],
    now: NOW,
    interaction: {
      interactionId,
      provider: 'instagram' as const,
      kind: 'DIRECT' as const,
      senderScopedId: 'ig-sender-1',
      text,
      occurredAt: NOW,
    },
    authorization: {
      factsVerified: true,
      writesEnabled: false,
      consentAllowed: false,
      approvalRequired: true,
      approvalSatisfied: false,
    },
  };
}

describe('social engagement lead engine', () => {
  it('resolves a contact and EventRecord, creates one lead and reuses it on retry', async () => {
    const harness = createHarness();
    const first = await harness.engine.process(
      input('event-1', 'Quero comprar ingresso para o sunset hoje, quanto custa?'),
    );
    const retry = await harness.engine.process(
      input('event-1', 'Quero comprar ingresso para o sunset hoje, quanto custa?'),
    );

    expect(first.classification).toMatchObject({
      intent: 'COMMERCIAL_LEAD',
      commercialIntent: 'HIGH',
      eventInterest: 'SUNSET',
      productEvent: 'SUNSET',
    });
    expect(first.eventRecord?.eventId).toBe('event-sunset-20260820');
    expect(first.nextAction).toBe('SALES_FOLLOW_UP');
    expect(first.replyDisposition).toBe('SUGGEST_ONLY');
    expect(first.leadCreated).toBe(true);
    expect(retry.leadCreated).toBe(false);
    expect(harness.contacts.size).toBe(1);
    expect(harness.leads.size).toBe(1);
    expect(first.lead?.attributes).not.toHaveProperty('text');
  });

  it('marks sensitive complaints as HUMAN_REQUIRED', async () => {
    const harness = createHarness();
    const result = await harness.engine.process(
      input('event-sensitive', 'Reclamacao urgente: ocorreu uma agressao agora.'),
    );

    expect(result.humanRequired).toBe(true);
    expect(result.replyDisposition).toBe('HUMAN_REQUIRED');
    expect(result.nextAction).toBe('HUMAN_REVIEW');
    expect(result.lead?.status).toBe('WORKING');
  });

  it('fails closed when sender identity cannot be resolved', async () => {
    const harness = createHarness();
    const base = input('event-no-sender', 'Quero ingresso para o sunset');
    const result = await harness.engine.process({
      ...base,
      interaction: {
        interactionId: base.interaction.interactionId,
        provider: base.interaction.provider,
        kind: base.interaction.kind,
        text: base.interaction.text,
        occurredAt: base.interaction.occurredAt,
      },
    });

    expect(result.humanRequired).toBe(true);
    expect(result.contact).toBeNull();
    expect(result.lead).toBeNull();
    expect(harness.leads.size).toBe(0);
  });

  it('keeps automatic replies fail-closed unless consent and approval gates are satisfied', async () => {
    const harness = createHarness();
    const base = input('event-hours', 'Que horas abre hoje?');
    const blocked = await harness.engine.process({
      ...base,
      authorization: {
        factsVerified: true,
        writesEnabled: true,
        consentAllowed: false,
        approvalRequired: true,
        approvalSatisfied: false,
      },
    });
    const allowed = await harness.engine.process({
      ...base,
      idempotencyKey: 'idem-hours-allowed',
      authorization: {
        factsVerified: true,
        writesEnabled: true,
        consentAllowed: true,
        approvalRequired: true,
        approvalSatisfied: true,
      },
    });

    expect(blocked.replyDisposition).toBe('SUGGEST_ONLY');
    expect(allowed.replyDisposition).toBe('AUTO_REPLY_ALLOWED');
    expect(allowed.lead).toBeNull();
  });
});

describe('social interaction normalization', () => {
  it('supports COMMENT, DIRECT, MENTION and REPLY without changing the persisted channel contract', () => {
    const payload = Buffer.from(
      JSON.stringify({
        object: 'instagram',
        entry: [
          {
            id: 'ig-account',
            time: 1787203800,
            changes: [
              {
                field: 'mentions',
                value: { id: 'mention-1', from: { id: 'sender-2' }, text: '@toca sunset' },
              },
              {
                field: 'comments',
                value: {
                  id: 'reply-1',
                  parent_id: 'comment-parent',
                  from: { id: 'sender-3' },
                  text: 'reply',
                },
              },
            ],
            messaging: [
              {
                sender: { id: 'sender-4' },
                recipient: { id: 'ig-account' },
                timestamp: 1787203800000,
                message: { mid: 'dm-1', text: 'direct' },
              },
            ],
          },
        ],
      }),
    );
    const events = parseMetaWebhookEvents(payload);
    const kinds = events.map((event) => socialInteractionFromInstagramWebhook(event).kind);

    expect(kinds).toContain('MENTION');
    expect(kinds).toContain('REPLY');
    expect(kinds).toContain('DIRECT');
    expect(events.every((event) => ['COMMENT', 'DIRECT'].includes(event.channel))).toBe(true);
  });

  it('classifies Sunset and The Party interest separately', () => {
    expect(classifySocialEngagement('Quero ir no sunset')).toMatchObject({
      eventInterest: 'SUNSET',
    });
    expect(classifySocialEngagement('Quanto custa a The Party?')).toMatchObject({
      eventInterest: 'THE_PARTY',
      commercialIntent: 'MEDIUM',
    });
  });
});
