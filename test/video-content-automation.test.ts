import { describe, expect, it } from 'vitest';
import type { VenueAsset } from '../src/contracts/creative-truth.js';
import type {
  PhotoToVideoSourceRights,
  PhotoToVideoStandard,
  ProductVideoPolicy,
  SceneContinuationApproval,
} from '../src/contracts/photo-to-video.js';
import {
  buildCanonicalVideoAutomationPlan,
  buildVideoAutomationWorkflowBlueprint,
  VIDEO_AUTOMATION_RENDER_MAX_ATTEMPTS,
  type VideoAutomationCanonicalContext,
} from '../src/creative/video-content-automation.js';

const venue: VenueAsset = {
  venueAssetId: 'VENUE-SUN-0244',
  sourceAssetId: 'SUN-0244',
  sourceDriveFileId: 'drive-source',
  masterAssetId: 'MM-SUN-0244-V1',
  masterDriveFileId: 'drive-master',
  sourceSha256: 'a'.repeat(64),
  masterSha256: 'b'.repeat(64),
  operation: 'SUNSET',
  locationSignature: 'deck',
  dominantSubject: 'sunset',
  venueVerified: true,
  marketingReady: true,
  generativeReferenceAllowed: true,
  protectedElements: ['DECK', 'HORIZON'],
  status: 'ACTIVE_APPROVED',
};

const rights: PhotoToVideoSourceRights = {
  sourceAssetId: 'SUN-0244',
  operation: 'SUNSET',
  rightsStatus: 'OWNED',
  containsPeople: false,
  likenessConsentStatus: 'NOT_APPLICABLE',
  approvedUses: ['PHOTO_TO_MOTION', 'SCENE_CONTINUATION'],
  evidenceRef: 'drive:rights:SUN-0244',
  status: 'ACTIVE',
  validatedAt: '2026-08-20T00:00:00-03:00',
};

const sunsetPolicy: ProductVideoPolicy = {
  productId: 'SUNSET',
  operation: 'SUNSET',
  displayName: 'Sunset',
  status: 'ACTIVE',
  photoMotionAllowed: true,
  sceneContinuationAllowed: true,
  heroBrand: 'TOCA_DO_MORCEGO',
  heroBrandVariant: 'WHITE',
  futureProductRuntimeMode: 'REGISTRY_DRIVEN',
};

const sunsetStandard: PhotoToVideoStandard = {
  standardId: 'SUNSET_STORY_PHOTO_MOTION_V1',
  version: '1.0',
  productId: 'SUNSET',
  operation: 'SUNSET',
  channel: 'INSTAGRAM',
  outputType: 'STORY',
  routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
  size: '720x1280',
  seconds: 8,
  motionPreset: 'SLOW_PUSH_IN',
  brandPosition: 'BOTTOM_CENTER',
  status: 'ACTIVE_CANONICAL',
  inheritsContentVisualStandard: true,
  exactAssetBindingRequired: true,
};

function sunsetContext(): VideoAutomationCanonicalContext {
  return {
    content: {
      contentItemId: 'CONTENT-SUNSET-1',
      productId: 'SUNSET',
      operation: 'SUNSET',
      outputType: 'STORY',
      inheritedVisualStandardId: 'SUNSET_STORY_VISUAL_V1',
      sourceAssetId: 'SUN-0244',
    },
    productPolicy: sunsetPolicy,
    standard: sunsetStandard,
    venueAsset: venue,
    rights,
  };
}

describe('video content automation', () => {
  it('builds the Sunset automation plan from canonical registry bindings only', () => {
    const plan = buildCanonicalVideoAutomationPlan({
      context: sunsetContext(),
      routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
      copy: {
        headline: 'Celebrar a Vida.',
        cta: 'Viva o pôr do sol.',
        caption: 'Sunset na Toca.',
        subtitles: [
          {
            cueId: 'cue-1',
            startMs: 0,
            endMs: 2_000,
            text: 'Celebrar a Vida.',
            speaker: null,
          },
        ],
      },
    });

    expect(plan.parentPolicyId).toBe('TOCA_CREATIVE_TRUTH_POLICY_V1');
    expect(plan.policyId).toBe('TOCA_PHOTO_TO_VIDEO_POLICY_V1');
    expect(plan.template.templateId).toBe('SUNSET_STORY_PHOTO_MOTION_V1');
    expect(plan.template.heroBrand).toBe('TOCA_DO_MORCEGO');
    expect(plan.template.brandPosition).toBe('BOTTOM_CENTER');
    expect(plan.template.aspectRatio).toBe('9:16');
    expect(plan.template.durationMs).toBe(8_000);
    expect(plan.template.typographyMode).toBe('HASH_BOUND_RASTER_OVERLAY_ONLY');
    expect(plan.storyboard[0]?.visualIntent).toBe('MOTION_FROM_PHOTO');
    expect(plan.shotSelection[0]?.assetId).toBe('MM-SUN-0244-V1');
    expect(plan.render.queue).toBe('EXISTING_WORKFLOW_STORE');
    expect(plan.render.cacheMode).toBe('PERSISTED_ARTIFACT_IDEMPOTENCY_REUSE');
    expect(plan.render.maxAttempts).toBe(VIDEO_AUTOMATION_RENDER_MAX_ATTEMPTS);
    expect(plan.approvalRequired).toBe(true);
    expect(plan.publicationAuthorized).toBe(false);
  });

  it('binds The Party to its canonical hero brand and top placement without copying a local template', () => {
    const context: VideoAutomationCanonicalContext = {
      content: {
        contentItemId: 'CONTENT-PARTY-1',
        productId: 'THE_PARTY',
        operation: 'THE_PARTY',
        outputType: 'REEL',
        inheritedVisualStandardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
        sourceAssetId: 'PARTY-001',
      },
      productPolicy: {
        ...sunsetPolicy,
        productId: 'THE_PARTY',
        operation: 'THE_PARTY',
        displayName: 'The Party',
        heroBrand: 'THE_PARTY',
      },
      standard: {
        ...sunsetStandard,
        standardId: 'THE_PARTY_REEL_PHOTO_MOTION_V1',
        productId: 'THE_PARTY',
        operation: 'THE_PARTY',
        outputType: 'REEL',
        brandPosition: 'TOP_CENTER',
      },
      venueAsset: {
        ...venue,
        venueAssetId: 'VENUE-PARTY-001',
        sourceAssetId: 'PARTY-001',
        sourceDriveFileId: 'party-source',
        masterAssetId: 'MM-PARTY-001-V1',
        masterDriveFileId: 'party-master',
        operation: 'THE_PARTY',
      },
      rights: {
        ...rights,
        sourceAssetId: 'PARTY-001',
        operation: 'THE_PARTY',
      },
    };

    const plan = buildCanonicalVideoAutomationPlan({
      context,
      routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
    });

    expect(plan.template.heroBrand).toBe('THE_PARTY');
    expect(plan.template.brandPosition).toBe('TOP_CENTER');
    expect(plan.template.templateId).toBe('THE_PARTY_REEL_PHOTO_MOTION_V1');
  });

  it('requires an exact source-bound approval for scene continuation', () => {
    const context = sunsetContext();
    const generativeStandard: PhotoToVideoStandard = {
      ...sunsetStandard,
      standardId: 'SUNSET_STORY_SCENE_CONTINUATION_V1',
      routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
    };

    expect(() =>
      buildCanonicalVideoAutomationPlan({
        context: { ...context, standard: generativeStandard },
        routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
      }),
    ).toThrow('VIDEO_AUTOMATION_SCENE_CONTINUATION_APPROVAL_REQUIRED');

    const approval: SceneContinuationApproval = {
      exceptionId: 'EXCEPTION-1',
      contentItemId: context.content.contentItemId,
      productId: 'SUNSET',
      operation: 'SUNSET',
      sourceAssetId: 'SUN-0244',
      sourceSha256: 'b'.repeat(64),
      requestedBy: 'principal:user',
      approvedBy: 'principal:approver',
      approvalRef: 'approval:scene-1',
      allowSceneContinuation: true,
      allowEnvironmentExpansion: false,
      allowArchitecturalInvention: false,
      allowAiLogoGeneration: false,
      peopleConsentConfirmed: false,
      status: 'APPROVED',
      createdAt: '2026-08-20T00:00:00-03:00',
    };
    const plan = buildCanonicalVideoAutomationPlan({
      context: { ...context, standard: generativeStandard, approval },
      routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
    });

    expect(plan.storyboard[0]?.visualIntent).toBe('SCENE_CONTINUATION');
    expect(plan.qualityGates).toContain('SCENE_CONTINUATION_FIDELITY');
  });

  it('changes the cache key when approved render inputs change', () => {
    const first = buildCanonicalVideoAutomationPlan({
      context: sunsetContext(),
      routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
      copy: { headline: 'Primeiro texto' },
    });
    const same = buildCanonicalVideoAutomationPlan({
      context: sunsetContext(),
      routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
      copy: { headline: 'Primeiro texto' },
    });
    const changed = buildCanonicalVideoAutomationPlan({
      context: sunsetContext(),
      routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
      copy: { headline: 'Outro texto' },
    });

    expect(first.render.cacheKey).toBe(same.render.cacheKey);
    expect(first.planSha256).toBe(same.planSha256);
    expect(changed.render.cacheKey).not.toBe(first.render.cacheKey);
    expect(changed.planSha256).not.toBe(first.planSha256);
  });

  it('uses the existing R20 workflow queue with bounded retries and a single approval gate', () => {
    const plan = buildCanonicalVideoAutomationPlan({
      context: sunsetContext(),
      routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
    });
    const blueprint = buildVideoAutomationWorkflowBlueprint(
      {
        workflowId: 'workflow-video-auto-1',
        definitionVersion: '1.1.0',
        idempotencyKey: 'video:auto:content-sunset-1',
        correlationId: 'correlation-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        organizationId: 'organization-1',
        requesterPrincipalId: 'principal-1',
        contentItemId: 'CONTENT-SUNSET-1',
        versionId: 'version-1',
        outputType: 'STORY',
        sourceFormat: 'STORY',
      },
      plan,
    );

    expect(blueprint.routeId).toBe('R20');
    expect(blueprint.definitionId).toBe('video-short-form-production');
    expect(
      blueprint.steps.find((step) => step.capabilityId === 'video.timeline.compose')?.maxAttempts,
    ).toBe(3);
    expect(
      blueprint.steps.find((step) => step.capabilityId === 'video.export.story')?.maxAttempts,
    ).toBe(3);
    expect(
      blueprint.steps.find((step) => step.capabilityId === 'approval.verify')?.maxAttempts,
    ).toBe(1);
    expect(blueprint.steps.filter((step) => step.capabilityId === 'approval.verify')).toHaveLength(
      1,
    );
    expect(blueprint.steps.map((step) => step.capabilityId)).not.toContain(
      'instagram.publish.story',
    );
  });

  it('fails closed when rights are unverified instead of inferring permission', () => {
    const context = sunsetContext();
    expect(() =>
      buildCanonicalVideoAutomationPlan({
        context: {
          ...context,
          rights: { ...context.rights, rightsStatus: 'UNVERIFIED' },
        },
        routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
      }),
    ).toThrow('VIDEO_AUTOMATION_RIGHTS_NOT_CLEARED');
  });
});
