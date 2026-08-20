import { describe, expect, it } from 'vitest';
import {
  SendGridEmailProvider,
  validateSendGridConfig,
  type SendGridPreparedCampaignResolver,
  type SendGridPreparedEmail,
} from '../src/providers/sendgrid/email-provider.js';

const prepared: SendGridPreparedEmail = {
  to: ['guest@example.com'],
  subject: 'Sua reserva',
  text: 'Olá',
  html: '<p>Olá</p>',
  internetMessageId: '<msg-1@mail.example.com>',
  customArgs: {
    toca_message_id: 'msg-1',
    toca_conversation_id: 'conv-1',
  },
  unsubscribeGroupId: 42,
  openTrackingRequested: true,
  clickTrackingRequested: true,
  privacyTrackingAllowed: false,
  policyTrackingAllowed: true,
};

const resolver: SendGridPreparedCampaignResolver = {
  resolve() {
    return Promise.resolve(prepared);
  },
};

const productionConfig = {
  apiKey: 'SG.fake-but-non-empty',
  sendingDomain: 'mail.example.com',
  fromEmail: 'contato@mail.example.com',
  fromName: 'TOCA',
  bindingId: 'sendgrid-prod-1',
  bindingState: 'PRODUCTION_VALIDATED' as const,
  emailActivityReadbackEnabled: false,
};

function fakeFetchReturning(response: Response): typeof fetch {
  const fakeFetch: typeof fetch = () => Promise.resolve(response);
  return fakeFetch;
}

describe('SendGrid email provider', () => {
  it('builds Mail Send payload with Privacy-gated tracking and without suppression bypasses', () => {
    const provider = new SendGridEmailProvider(
      productionConfig,
      resolver,
      fakeFetchReturning(new Response()),
    );
    const payload = provider.buildMailSendPayload(prepared, 'idem-1');
    expect(payload.tracking_settings).toEqual({
      open_tracking: { enable: false },
      click_tracking: { enable: false, enable_text: false },
    });
    expect(payload.mail_settings).toBeUndefined();
    expect(payload.asm).toEqual({ group_id: 42 });
    expect(payload.headers).toEqual({ 'Message-ID': '<msg-1@mail.example.com>' });
  });

  it('refuses real send unless the provider binding is PRODUCTION_VALIDATED', async () => {
    const provider = new SendGridEmailProvider(
      { ...productionConfig, bindingState: 'INTEGRATION_VALIDATED' },
      resolver,
      fakeFetchReturning(new Response(null, { status: 202, headers: { 'x-message-id': 'sg-1' } })),
    );
    await expect(
      provider.sendCampaign({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
        correlationId: 'corr-1',
        preparedCampaignRef: 'prepared-1',
        eligibilitySnapshot: {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          organizationId: 'org-1',
          correlationId: 'corr-1',
          snapshotId: 'audience-1',
          purposeId: 'reservation-followup',
          resolvedContactCount: 1,
          ambiguousContactCount: 0,
          unresolvedContactCount: 0,
          privacyUnknownBlockedCount: 0,
          privacySuppressedCount: 0,
          policyDeniedCount: 0,
        },
        approval: {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          organizationId: 'org-1',
          correlationId: 'corr-1',
          approvalId: 'approval-1',
          status: 'APPROVED',
        },
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toThrow('OMNICHANNEL_PROVIDER_NOT_PRODUCTION_VALIDATED');
  });

  it('returns a provider receipt only after SendGrid accepts the request', async () => {
    const provider = new SendGridEmailProvider(
      productionConfig,
      resolver,
      fakeFetchReturning(
        new Response(null, { status: 202, headers: { 'x-message-id': 'sg-msg-1' } }),
      ),
    );
    const receipt = await provider.sendCampaign({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      organizationId: 'org-1',
      correlationId: 'corr-1',
      preparedCampaignRef: 'prepared-1',
      eligibilitySnapshot: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
        correlationId: 'corr-1',
        snapshotId: 'audience-1',
        purposeId: 'reservation-followup',
        resolvedContactCount: 1,
        ambiguousContactCount: 0,
        unresolvedContactCount: 0,
        privacyUnknownBlockedCount: 0,
        privacySuppressedCount: 0,
        policyDeniedCount: 0,
      },
      approval: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
        correlationId: 'corr-1',
        approvalId: 'approval-1',
        status: 'APPROVED',
      },
      idempotencyKey: 'idem-1',
    });
    expect(receipt.provider).toBe('twilio-sendgrid');
    expect(receipt.providerMessageId).toBe('sg-msg-1');
    expect(receipt.state).toBe('ACCEPTED');
  });

  it('fails closed when independent Email Activity readback is not enabled', async () => {
    const provider = new SendGridEmailProvider(
      productionConfig,
      resolver,
      fakeFetchReturning(new Response()),
    );
    await expect(provider.readback('sg-msg-1')).rejects.toThrow(
      'SENDGRID_EMAIL_ACTIVITY_READBACK_NOT_ENABLED',
    );
  });

  it('validates sender/domain binding locally before any provider request', () => {
    expect(() => validateSendGridConfig(productionConfig)).not.toThrow();
    expect(() =>
      validateSendGridConfig({ ...productionConfig, fromEmail: 'contato@another.example' }),
    ).toThrow('SENDGRID_FROM_DOMAIN_MISMATCH');
  });

  it('normalizes signed webhook events into delivery and Privacy signals', () => {
    const provider = new SendGridEmailProvider(
      productionConfig,
      resolver,
      fakeFetchReturning(new Response()),
    );
    const events = provider.normalizeEventWebhook(
      Buffer.from(
        JSON.stringify([
          {
            sg_event_id: 'event-1',
            sg_message_id: 'sg-msg-1',
            event: 'spamreport',
            email: 'Guest@Example.com',
            timestamp: 1787202000,
          },
        ]),
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.deliveryState).toBe('COMPLAINT');
    expect(events[0]?.privacySignal).toBe('COMPLAINT');
    expect(events[0]?.email).toBe('guest@example.com');
  });
});
