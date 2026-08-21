import { describe, expect, it } from 'vitest';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { resolveOmnichannelReadbackRuntimeBinding } from '../src/mcp/omnichannel-readback-runtime.js';
import {
  PostgresOmnichannelProviderEventReadback,
  type OmnichannelProviderEventReadbackService,
} from '../src/omnichannel/provider-event-readback.js';
import type { ProviderMessageReadback } from '../src/omnichannel/contracts.js';
import type pg from 'pg';

const scope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  organizationId: 'org-a',
} as const;

const identity = createTrustedServiceExecutionIdentity({
  principalId: 'service:test-omnichannel-readback',
  ...scope,
  roles: ['READER'],
  allowedCapabilityIds: ['email.delivery.readback', 'whatsapp.message.readback'],
  evidence: ['test:omnichannel-readback'],
  now: '2026-08-21T00:00:00.000Z',
});

function poolWithRows(rows: readonly unknown[][]): pg.Pool {
  let index = 0;
  return {
    query() {
      const next = rows[index++] ?? [];
      return Promise.resolve({ rows: next });
    },
  } as unknown as pg.Pool;
}

describe('PostgresOmnichannelProviderEventReadback', () => {
  it('returns latest signed SendGrid provider evidence within the requested scope', async () => {
    const service = new PostgresOmnichannelProviderEventReadback(
      poolWithRows([
        [{ state: 'ACCEPTED', updated_at: '2026-08-21T00:00:00.000Z' }],
        [
          {
            event_type: 'delivered',
            delivery_state: 'DELIVERED',
            occurred_at: '2026-08-21T00:01:00.000Z',
            evidence: ['sendgrid:event-webhook:ecdsa-valid'],
          },
        ],
      ]),
    );

    await expect(
      service.readEmail({ ...scope, providerMessageId: 'sg-message-1' }),
    ).resolves.toMatchObject({
      provider: 'twilio-sendgrid',
      providerMessageId: 'sg-message-1',
      state: 'DELIVERED',
      observedAt: '2026-08-21T00:01:00.000Z',
      evidence: ['sendgrid:event:delivered', 'sendgrid:event-webhook:ecdsa-valid'],
    });
  });

  it('maps WhatsApp READ provider evidence to delivered without losing the provider status evidence', async () => {
    const service = new PostgresOmnichannelProviderEventReadback(
      poolWithRows([
        [{ state: 'DELIVERED', updated_at: '2026-08-21T00:00:00.000Z' }],
        [
          {
            status: 'READ',
            observed_at: '2026-08-21T00:02:00.000Z',
            evidence: ['meta:webhook-signature-valid'],
          },
        ],
      ]),
    );

    await expect(
      service.readWhatsApp({ ...scope, providerMessageId: 'wamid.1' }),
    ).resolves.toMatchObject({
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId: 'wamid.1',
      state: 'DELIVERED',
      evidence: ['whatsapp:provider-event:READ', 'meta:webhook-signature-valid'],
    });
  });

  it('fails closed when the provider message is not bound to the requested scope', async () => {
    const service = new PostgresOmnichannelProviderEventReadback(poolWithRows([[]]));
    await expect(
      service.readEmail({ ...scope, providerMessageId: 'other-tenant-message' }),
    ).rejects.toThrow('EMAIL_DELIVERY_READBACK_DISPATCH_NOT_FOUND');
  });
});

describe('Omnichannel Core readback bindings', () => {
  const service: OmnichannelProviderEventReadbackService = {
    readEmail(input): Promise<ProviderMessageReadback> {
      return Promise.resolve({
        provider: 'twilio-sendgrid',
        providerMessageId: input.providerMessageId,
        state: 'DELIVERED',
        observedAt: '2026-08-21T00:01:00.000Z',
        evidence: ['test:email-readback'],
      });
    },
    readWhatsApp(input): Promise<ProviderMessageReadback> {
      return Promise.resolve({
        provider: 'META_WHATSAPP_CLOUD',
        providerMessageId: input.providerMessageId,
        state: 'SENT',
        observedAt: '2026-08-21T00:01:00.000Z',
        evidence: ['test:whatsapp-readback'],
      });
    },
  };

  it('binds email readback and preserves the canonical tenant scope', async () => {
    const binding = resolveOmnichannelReadbackRuntimeBinding('email.delivery.readback', service);
    expect(binding).toBeDefined();
    await expect(
      binding!.execute(
        {
          tenant_id: scope.tenantId,
          workspace_id: scope.workspaceId,
          organization_id: scope.organizationId,
          provider_dispatch_id: 'sg-message-1',
        },
        { identity, executionId: 'exec-1', correlationId: 'corr-1' },
      ),
    ).resolves.toMatchObject({
      provider_dispatch_id: 'sg-message-1',
      state: 'DELIVERED',
      evidence: ['test:email-readback'],
    });
  });

  it('rejects a payload that tries to cross the authenticated tenant scope', async () => {
    const binding = resolveOmnichannelReadbackRuntimeBinding('whatsapp.message.readback', service);
    await expect(
      binding!.execute(
        {
          tenant_id: 'tenant-b',
          workspace_id: scope.workspaceId,
          organization_id: scope.organizationId,
          provider_message_id: 'wamid.1',
        },
        { identity, executionId: 'exec-2', correlationId: 'corr-2' },
      ),
    ).rejects.toThrow('OMNICHANNEL_READBACK_SCOPE_MISMATCH');
  });
});
