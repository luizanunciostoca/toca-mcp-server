import { describe, expect, it } from 'vitest';
import {
  assertOmnichannelPreparedContentIntegrity,
  buildOmnichannelPreparedContentRecord,
  canonicalJson,
} from '../src/omnichannel/prepared-content.js';

const scope = {
  tenantId: 'toca',
  workspaceId: 'toca',
  organizationId: 'toca',
} as const;

describe('Omnichannel prepared content', () => {
  it('is content-addressed and canonical across object key order', () => {
    const first = buildOmnichannelPreparedContentRecord({
      ...scope,
      contentKind: 'EMAIL_CAMPAIGN',
      payload: { subject: 'Sunset', nested: { b: 2, a: 1 } },
      evidence: ['test:prepared'],
      now: '2026-08-21T04:00:00.000Z',
    });
    const second = buildOmnichannelPreparedContentRecord({
      ...scope,
      contentKind: 'EMAIL_CAMPAIGN',
      payload: { nested: { a: 1, b: 2 }, subject: 'Sunset' },
      evidence: ['test:prepared'],
      now: '2026-08-21T04:01:00.000Z',
    });
    expect(first.preparedContentRef).toBe(second.preparedContentRef);
    expect(first.contentSha256).toBe(second.contentSha256);
    expect(canonicalJson(first.payload)).toBe(canonicalJson(second.payload));
    expect(() => assertOmnichannelPreparedContentIntegrity(first)).not.toThrow();
  });

  it('separates references by tenant and channel kind', () => {
    const email = buildOmnichannelPreparedContentRecord({
      ...scope,
      contentKind: 'EMAIL_CAMPAIGN',
      payload: { body: 'same' },
      evidence: ['test:email'],
    });
    const whatsapp = buildOmnichannelPreparedContentRecord({
      ...scope,
      contentKind: 'WHATSAPP_MESSAGE',
      payload: { body: 'same' },
      evidence: ['test:whatsapp'],
    });
    const sibling = buildOmnichannelPreparedContentRecord({
      tenantId: 'other',
      workspaceId: 'other',
      organizationId: 'other',
      contentKind: 'EMAIL_CAMPAIGN',
      payload: { body: 'same' },
      evidence: ['test:other'],
    });
    expect(email.preparedContentRef).not.toBe(whatsapp.preparedContentRef);
    expect(email.preparedContentRef).not.toBe(sibling.preparedContentRef);
  });
});
