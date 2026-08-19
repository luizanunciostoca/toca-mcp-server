import { describe, expect, it, vi } from 'vitest';
import { resolveInstagramPublicationRuntimeBinding } from '../src/mcp/instagram-publication-runtime.js';
import { createRuntimeCapabilityResolver } from '../src/mcp/runtime-capability-resolver.js';
import { InMemoryScheduler } from '../src/scheduler/in-memory-scheduler.js';
import { TocaManagedInstagramScheduler } from '../src/scheduler/toca-managed-instagram-scheduler.js';
import { createToolRegistry } from '../src/registry.js';

const account = {
  pageId: '306103746115875',
  instagramAccountId: '17841402033495654',
};

function publishedResult(mediaId = 'media-1') {
  return {
    publication: {
      publicationId: 'corr-1',
      correlationId: 'corr-1',
      idempotencyKey: 'provider-key',
      state: 'PUBLISHED' as const,
      externalMediaId: mediaId,
      updatedAt: '2026-08-16T12:00:00.000Z',
    },
    completed: true,
  };
}

describe('Instagram direct publication Core runtime', () => {
  it('promotes only direct publish capabilities while generic scheduling remains planned', () => {
    const registry = createToolRegistry({ instagramPublicationWritesEnabled: true });
    for (const capabilityId of [
      'instagram.publish.image',
      'instagram.publish.carousel',
      'instagram.publish.reel',
      'instagram.publish.story',
    ]) {
      expect(registry.get(capabilityId)).toMatchObject({
        capabilityStatus: 'PRODUCTION_VALIDATED',
        riskClass: 'WRITE_EXTERNAL',
        sideEffects: true,
        idempotent: true,
      });
    }
    expect(registry.get('instagram.publication.schedule')?.capabilityStatus).toBe('PLANNED');
    expect(registry.get('instagram.publication.reschedule')?.capabilityStatus).toBe('PLANNED');

    const disabledRuntimeRegistry = createToolRegistry({
      instagramPublicationWritesEnabled: false,
      tocaManagedInstagramSchedulerEnabled: true,
    });
    for (const capabilityId of [
      'instagram.publish.image',
      'instagram.publish.carousel',
      'instagram.publish.reel',
      'instagram.publish.story',
    ]) {
      expect(disabledRuntimeRegistry.get(capabilityId)?.capabilityStatus).toBe('PLANNED');
    }

    const catalogRegistry = createToolRegistry({ tocaManagedInstagramSchedulerEnabled: true });
    expect(catalogRegistry.get('instagram.publish.image')?.capabilityStatus).toBe(
      'PRODUCTION_VALIDATED',
    );
  });

  it('binds image publication to the configured account, deterministic idempotency and provider readback', async () => {
    const execute = vi.fn(() => Promise.resolve(publishedResult()));
    const getPublishedMedia = vi.fn(() =>
      Promise.resolve({
        mediaId: 'media-1',
        mediaType: 'IMAGE',
        caption: 'Celebrar a Vida.',
        permalink: 'https://www.instagram.com/p/media-1/',
      }),
    );
    const binding = resolveInstagramPublicationRuntimeBinding('instagram.publish.image', {
      executor: { execute },
      transport: { getPublishedMedia },
      allowedInstagramAccountId: account.instagramAccountId,
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });
    expect(binding).toBeDefined();
    expect(binding?.sideEffectValidated).toBe(true);

    const payload = {
      account,
      mediaUrls: ['https://cdn.example.com/image.jpg'],
      caption: 'Celebrar a Vida.',
      correlationId: 'corr-1',
      idempotencyKey: 'request-1',
    };
    const parsed = binding!.inputSchema.parse(payload);
    const idempotencyKey = binding!.idempotencyKey?.(parsed);
    expect(idempotencyKey).toMatch(/^instagram:direct:[a-f0-9]{64}$/);
    expect(binding!.targetAccount?.(parsed)).toBe(account.instagramAccountId);

    const result = await binding!.execute(parsed);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        account,
        mediaType: 'IMAGE',
        mediaUrls: payload.mediaUrls,
        caption: payload.caption,
        correlationId: payload.correlationId,
        idempotencyKey,
      }),
    );
    const readback = await binding!.providerReadback!(result, parsed);
    expect(readback).toMatchObject({
      verified: true,
      externalResourceId: 'media-1',
    });
    expect(getPublishedMedia).toHaveBeenCalledWith('media-1');
  });

  it('supports carousel 2-10 images, reel and story schemas without a parallel provider path', () => {
    const runtime = {
      executor: { execute: vi.fn(() => Promise.resolve(publishedResult())) },
      transport: {
        getPublishedMedia: vi.fn(() => Promise.resolve({ mediaId: 'media-1', mediaType: 'IMAGE' })),
      },
      allowedInstagramAccountId: account.instagramAccountId,
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    };
    const carouselBinding = resolveInstagramPublicationRuntimeBinding(
      'instagram.publish.carousel',
      runtime,
    );
    expect(
      carouselBinding?.inputSchema.parse({
        account,
        mediaUrls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
        correlationId: 'corr-carousel-min',
        idempotencyKey: 'carousel-min',
      }),
    ).toBeDefined();
    expect(
      carouselBinding?.inputSchema.parse({
        account,
        mediaUrls: Array.from(
          { length: 10 },
          (_, index) => `https://cdn.example.com/${index + 1}.jpg`,
        ),
        correlationId: 'corr-carousel-max',
        idempotencyKey: 'carousel-max',
      }),
    ).toBeDefined();
    expect(() =>
      carouselBinding?.inputSchema.parse({
        account,
        mediaUrls: ['https://cdn.example.com/only-one.jpg'],
        correlationId: 'corr-carousel-underflow',
        idempotencyKey: 'carousel-underflow',
      }),
    ).toThrow();
    expect(() =>
      carouselBinding?.inputSchema.parse({
        account,
        mediaUrls: Array.from(
          { length: 11 },
          (_, index) => `https://cdn.example.com/${index + 1}.jpg`,
        ),
        correlationId: 'corr-carousel-overflow',
        idempotencyKey: 'carousel-overflow',
      }),
    ).toThrow();
    expect(
      resolveInstagramPublicationRuntimeBinding(
        'instagram.publish.reel',
        runtime,
      )?.inputSchema.parse({
        account,
        mediaUrls: ['https://cdn.example.com/reel.mp4'],
        correlationId: 'corr-reel',
        idempotencyKey: 'reel-1',
      }),
    ).toBeDefined();
    expect(
      resolveInstagramPublicationRuntimeBinding(
        'instagram.publish.story',
        runtime,
      )?.inputSchema.parse({
        account,
        mediaUrls: ['https://cdn.example.com/story.jpg'],
        correlationId: 'corr-story',
        idempotencyKey: 'story-1',
      }),
    ).toBeDefined();
  });

  it('fails closed when the request targets a different Instagram account', async () => {
    const binding = resolveInstagramPublicationRuntimeBinding('instagram.publish.image', {
      executor: { execute: vi.fn(() => Promise.resolve(publishedResult())) },
      transport: {
        getPublishedMedia: vi.fn(() => Promise.resolve({ mediaId: 'media-1', mediaType: 'IMAGE' })),
      },
      allowedInstagramAccountId: account.instagramAccountId,
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });
    const parsed = binding!.inputSchema.parse({
      account: { ...account, instagramAccountId: 'other-account' },
      mediaUrls: ['https://cdn.example.com/image.jpg'],
      correlationId: 'corr-other',
      idempotencyKey: 'other-1',
    });
    await expect(binding!.execute(parsed)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_TARGET_ACCOUNT_NOT_ALLOWED',
    );
  });

  it('marks TOCA-managed reschedule as a validated side-effect binding', () => {
    const scheduler = new TocaManagedInstagramScheduler(new InMemoryScheduler());
    const binding = createRuntimeCapabilityResolver({ instagramScheduler: scheduler })(
      'instagram.toca_schedule.reschedule',
    );
    expect(binding).toBeDefined();
    expect(binding?.sideEffectValidated).toBe(true);
    expect(binding?.idempotencyKey).toBeTypeOf('function');
    expect(binding?.providerReadback).toBeTypeOf('function');
  });
});
