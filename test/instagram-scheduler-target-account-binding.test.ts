import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRuntimeCapabilityResolver } from '../src/mcp/runtime-capability-resolver.js';
import {
  hashTocaManagedInstagramApprovalDescriptor,
  type TocaManagedInstagramApprovalDescriptor,
  type TocaManagedInstagramScheduler,
} from '../src/scheduler/toca-managed-instagram-scheduler.js';

function payload() {
  const descriptor: TocaManagedInstagramApprovalDescriptor = {
    schemaVersion: 1,
    contentItemId: 'TARGET-ACCOUNT-BINDING-PROOF',
    scheduledFor: '2099-01-01T12:00:00-03:00',
    timezone: 'America/Bahia',
    account: {
      pageId: 'PAGE_TARGET',
      instagramAccountId: 'IG_TARGET',
    },
    mediaType: 'IMAGE',
    asset: {
      assetId: 'ASSET_TARGET',
      objectName: 'instagram/target-account-proof.jpg',
      sha256: '0'.repeat(64),
      contentType: 'image/jpeg',
    },
    caption: 'target account proof',
    correlationId: 'target-account-binding-proof',
    publicationIdempotencyKey: 'target-account-binding-proof',
  };

  return {
    ...descriptor,
    approval: {
      mode: 'EXPLICIT_APPROVAL' as const,
      status: 'APPROVED' as const,
      approvedDescriptorSha256: hashTocaManagedInstagramApprovalDescriptor(descriptor),
    },
  };
}

describe('managed Instagram scheduler target-account binding', () => {
  it('binds create writes to the Instagram account in the approved descriptor', () => {
    const resolver = createRuntimeCapabilityResolver({
      instagramScheduler: () => ({}) as TocaManagedInstagramScheduler,
    });
    const binding = resolver('instagram.toca_schedule.create');
    const input = payload();

    expect(binding).toBeDefined();
    expect(binding?.targetAccount).toBeDefined();
    expect(binding?.targetAccount?.(input)).toBe('IG_TARGET');
  });

  it('allows the configured Instagram account for the managed scheduler runtime identity', () => {
    const serverSource = readFileSync('src/server.ts', 'utf8');

    expect(serverSource).toContain(
      '(directPublicationEnabled || config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED)',
    );
    expect(serverSource).toContain('? [config.INSTAGRAM_BUSINESS_ACCOUNT_ID]');
  });
});
