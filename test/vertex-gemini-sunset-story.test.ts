import { describe, expect, it } from 'vitest';
import type { SunsetStoryAiRenderPlannerRequest } from '../src/creative/sunset-story-render-plan.js';
import { loadSunsetStoryTemplateContract } from '../src/creative/sunset-story-template-contract.js';
import { VertexGeminiSunsetStoryAiPlanner } from '../src/providers/gcp/vertex-gemini-sunset-story.js';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('Vertex Gemini Sunset Story planner', () => {
  it('sends the exact source photo bytes and MIME type to the multimodal planner', async () => {
    let observedBody = '';
    const fetchImpl: typeof fetch = async (_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('TEST_VERTEX_BODY_MISSING');
      observedBody = init.body;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      fontScales: [],
                      assetScales: [],
                      localDarkening: [],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const planner = new VertexGeminiSunsetStoryAiPlanner({
      projectId: 'toca-test-project',
      fetchImpl,
      accessTokenProvider: { getAccessToken: () => Promise.resolve('test-token') },
    });
    const contract = await loadSunsetStoryTemplateContract('SUNSET_TEMPLATE_MASTER_V9');
    const request: SunsetStoryAiRenderPlannerRequest & {
      readonly sourceImageBytes: Uint8Array;
      readonly sourceImageMimeType: 'image/png';
    } = {
      templateId: 'SUNSET_TEMPLATE_MASTER_V9',
      intent: 'SCENERY',
      imageProfile: {
        width: 1080,
        height: 1920,
        sourceAspectRatio: 9 / 16,
        primarySubject: null,
        primarySubjectZone: null,
        negativeSpaceZones: ['CENTER'],
        regionLuma: { CENTER: 0.4 },
        warmth: 0.7,
        crop9x16Fitness: 100,
        horizonY: 0.45,
        sceneClass: 'SEA_VIEW',
        brightness: 'MEDIUM',
      },
      cropPlan: {
        cropWindow: { x: 0, y: 0, width: 1, height: 1 },
        transformedPrimarySubject: null,
        subjectCoverage: 1,
        protectedOverlap: 0,
        placementScore: 1,
        planScore: 100,
      },
      canonicalContract: contract,
      sourceImageBytes: PNG_BYTES,
      sourceImageMimeType: 'image/png',
    };

    const plan = await planner.plan(request);

    expect(plan.templateId).toBe('SUNSET_TEMPLATE_MASTER_V9');
    expect(observedBody).toContain('"mimeType":"image/png"');
    expect(observedBody).toContain(Buffer.from(PNG_BYTES).toString('base64'));
    expect(observedBody).toContain('GOOGLE_DRIVE');
    expect(observedBody).toContain('Manual-derived typography');
  });
});
