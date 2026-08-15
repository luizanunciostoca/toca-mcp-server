import { describe, expect, it } from 'vitest';
import {
  assertContentItemStateTransition,
  planContentRepurpose,
  validateAccessibility,
  validateContentItemVersion,
  validateFactClaims,
  validateRights,
  type ContentItemVersion,
} from '../src/content/content-item.js';
import {
  buildVideoProductionWorkflowBlueprint,
  validateDuration,
  validateExportManifest,
  validateSafeArea,
  validateSelectedVideoAssets,
  validateVideoQuality,
  type VideoTimeline,
} from '../src/content/video.js';

const rootVersion: ContentItemVersion = {
  versionId: 'version-root',
  contentItemId: 'content-1',
  versionNumber: 1,
  idempotencyKey: 'content-1:root',
  derivationType: 'ORIGINAL',
  parentVersionId: null,
  sourceVersionId: null,
  lineageRootVersionId: 'version-root',
  variantKey: null,
  channel: 'INSTAGRAM',
  format: 'REEL',
  language: 'pt-BR',
  sourceAssetIds: ['asset-original'],
  derivedAssetIds: [],
  payload: { headline: 'Celebrar a Vida.' },
  sourceRefs: ['drive:canonical-product'],
  evidence: ['drive:creative-pipeline'],
  createdAt: '2026-08-15T05:00:00.000Z',
};

const timeline: VideoTimeline = {
  timelineId: 'timeline-1',
  contentItemId: 'content-1',
  versionId: 'version-root',
  durationMs: 15_000,
  width: 1080,
  height: 1920,
  clips: [
    {
      clipId: 'clip-1',
      assetId: 'asset-master',
      sourceAssetId: 'asset-original',
      timelineStartMs: 0,
      timelineEndMs: 15_000,
      sourceInMs: 0,
      sourceOutMs: 15_000,
    },
  ],
  overlays: [
    {
      overlayId: 'headline',
      text: 'Celebrar a Vida.',
      startMs: 0,
      endMs: 5_000,
      x: 120,
      y: 220,
      width: 840,
      height: 220,
    },
  ],
  evidence: ['timeline:deterministic'],
};

describe('R20/R29 video and content foundation', () => {
  it('preserves original -> derivation lineage across repurposed destinations', () => {
    expect(() => validateContentItemVersion(rootVersion)).not.toThrow();
    const plan = planContentRepurpose(rootVersion, [
      { variantKey: 'reel-pt', channel: 'INSTAGRAM', format: 'REEL', language: 'pt-BR' },
      { variantKey: 'story-en', channel: 'INSTAGRAM', format: 'STORY', language: 'en-US' },
    ]);
    expect(plan).toHaveLength(2);
    expect(plan.every((item) => item.sourceVersionId === rootVersion.versionId)).toBe(true);
    expect(plan.every((item) => item.lineageRootVersionId === rootVersion.versionId)).toBe(true);
    expect(plan.every((item) => item.sourceAssetIds[0] === 'asset-original')).toBe(true);
  });

  it('rejects duplicate repurposing destinations deterministically', () => {
    expect(() =>
      planContentRepurpose(rootVersion, [
        { variantKey: 'same', channel: 'INSTAGRAM', format: 'REEL', language: 'pt-BR' },
        { variantKey: 'same', channel: 'INSTAGRAM', format: 'REEL', language: 'pt-BR' },
      ]),
    ).toThrow('CONTENT_REPURPOSE_DUPLICATE_DESTINATION');
  });

  it('fails closed on unsupported lifecycle regressions', () => {
    expect(() => assertContentItemStateTransition('APPROVED', 'PLANNED')).toThrow(
      'CONTENT_ITEM_STATE_TRANSITION_INVALID',
    );
    expect(() => assertContentItemStateTransition('REVIEW', 'IN_PRODUCTION')).not.toThrow();
  });

  it('requires factual sources and exact observed facts', () => {
    expect(
      validateFactClaims([
        {
          claimId: 'event-date',
          expected: '2026-08-15',
          observed: '2026-08-15',
          sourceRefs: ['event:canonical'],
        },
      ]),
    ).toBe('PASS');
    expect(
      validateFactClaims([
        {
          claimId: 'event-date',
          expected: '2026-08-15',
          observed: '2026-08-16',
          sourceRefs: ['event:canonical'],
        },
      ]),
    ).toBe('FAIL');
  });

  it('treats unknown rights as review-required and expired rights as a hard failure', () => {
    expect(
      validateRights([
        { assetId: 'asset-1', status: 'UNKNOWN', evidence: ['rights:lookup'] },
      ]),
    ).toBe('REVIEW_REQUIRED');
    expect(
      validateRights(
        [
          {
            assetId: 'asset-1',
            status: 'LICENSED',
            validUntil: '2026-08-14T00:00:00.000Z',
            evidence: ['license:contract'],
          },
        ],
        '2026-08-15T00:00:00.000Z',
      ),
    ).toBe('FAIL');
  });

  it('enforces master-first selection when a marketing master is available', () => {
    expect(() =>
      validateSelectedVideoAssets([
        {
          assetId: 'asset-original',
          sourceAssetId: 'asset-original',
          masterAssetId: null,
          masterAvailable: true,
          rightsStatus: 'PASS',
          fitnessScore: 95,
          selectionRationale: 'Best semantic fit',
        },
      ]),
    ).toThrow('VIDEO_MARKETING_MASTER_REQUIRED');
  });

  it('validates caller-supplied safe areas and versioned duration policy', () => {
    expect(validateSafeArea(timeline, { topPx: 100, rightPx: 80, bottomPx: 180, leftPx: 80 })).toEqual({
      status: 'PASS',
      violations: [],
    });
    expect(validateSafeArea(timeline, { topPx: 300, rightPx: 80, bottomPx: 180, leftPx: 80 }).status).toBe(
      'FAIL',
    );
    expect(validateDuration(15_000, { minimumMs: 1_000, maximumMs: 90_000 })).toBe('PASS');
    expect(validateDuration(100_000, { minimumMs: 1_000, maximumMs: 90_000 })).toBe('FAIL');
  });

  it('requires captions/readability when speech is present', () => {
    expect(
      validateAccessibility({
        hasSpeech: true,
        captionsPresent: false,
        captionsReadable: false,
        meaningfulAudioDescribedOrNonEssential: true,
        textContrastPass: true,
      }),
    ).toBe('FAIL');
  });

  it('aggregates hard quality gates and blocks export until approval and quality pass', () => {
    const quality = validateVideoQuality([
      { gate: 'rights', status: 'PASS', issues: [], evidence: ['rights:ok'] },
      { gate: 'accessibility', status: 'PASS', issues: [], evidence: ['a11y:ok'] },
      { gate: 'safe-area', status: 'PASS', issues: [], evidence: ['safe-area:ok'] },
    ]);
    expect(quality.status).toBe('PASS');
    expect(() =>
      validateExportManifest({
        exportId: 'export-1',
        outputType: 'REEL',
        contentItemId: 'content-1',
        versionId: 'version-root',
        lineageRootVersionId: 'version-root',
        sourceAssetIds: ['asset-original'],
        derivedAssetId: 'asset-derived',
        artifactRef: 'drive:artifact',
        width: 1080,
        height: 1920,
        durationMs: 15_000,
        approvalRef: 'approval:123',
        quality,
        evidence: ['export:readback'],
      }),
    ).not.toThrow();
  });

  it('reuses the durable workflow engine and approval gate without a publishing step', () => {
    const blueprint = buildVideoProductionWorkflowBlueprint({
      workflowId: 'workflow-video-1',
      definitionVersion: '1.0.0',
      idempotencyKey: 'video:content-1:version-root',
      correlationId: 'correlation-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      organizationId: 'organization-1',
      requesterPrincipalId: 'principal-1',
      contentItemId: 'content-1',
      versionId: 'version-root',
      outputType: 'REEL',
      sourceFormat: 'REEL',
    });
    const capabilityIds = blueprint.steps.map((step) => step.capabilityId);
    expect(blueprint.routeId).toBe('R20');
    expect(capabilityIds).toContain('approval.verify');
    expect(capabilityIds).toContain('video.export.reel');
    expect(capabilityIds).not.toContain('content_item.publish');
    expect(capabilityIds).not.toContain('instagram.publish.reel');
  });
});
