import { describe, expect, it } from 'vitest';
import {
  THE_PARTY_ITACARE_GENERATIVE_CAMPAIGN_ID,
  THE_PARTY_ITACARE_GENERATIVE_SCENE_COUNT,
  THE_PARTY_ITACARE_GENERATIVE_VIDEOS,
  THE_PARTY_ITACARE_SOURCES,
} from '../src/config/the-party-itacare-generative-campaign.js';

describe('The Party Itacare governed video campaign', () => {
  it('pins the campaign to exactly ten review videos and twenty unique scenes', () => {
    expect(THE_PARTY_ITACARE_GENERATIVE_CAMPAIGN_ID).toBe('TP-ITA-20261011-GENERATIVE-V1');
    expect(THE_PARTY_ITACARE_GENERATIVE_VIDEOS).toHaveLength(10);
    expect(THE_PARTY_ITACARE_GENERATIVE_SCENE_COUNT).toBe(20);

    const sceneIds = THE_PARTY_ITACARE_GENERATIVE_VIDEOS.flatMap((video) =>
      video.scenes.map((scene) => scene.contentItemId),
    );
    const finalIds = THE_PARTY_ITACARE_GENERATIVE_VIDEOS.map(
      (video) => video.finalContentItemId,
    );
    expect(new Set(sceneIds).size).toBe(sceneIds.length);
    expect(new Set(finalIds).size).toBe(finalIds.length);
  });

  it('pins every source to an exact Drive file and sha256 digest', () => {
    for (const source of Object.values(THE_PARTY_ITACARE_SOURCES)) {
      expect(source.driveFileId).toMatch(/^[A-Za-z0-9_-]+$/u);
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(source.assetId).toMatch(/^TP-ITA-/u);
      expect(source.venueAssetId).toMatch(/^VENUE-TP-ITA-/u);
    }
  });

  it('never sends recognizable artist sources through scene continuation', () => {
    for (const video of THE_PARTY_ITACARE_GENERATIVE_VIDEOS) {
      for (const scene of video.scenes) {
        const source = THE_PARTY_ITACARE_SOURCES[scene.source];
        expect(source.approvedRoutes).toContain(scene.routeType);
        if (source.containsPeople) {
          expect(scene.routeType).toBe('REAL_PHOTO_TO_MOTION_VIDEO');
          expect(scene.creativeDirection).toBeUndefined();
        }
      }
    }
  });

  it('requires source-locked direction for every generative venue scene', () => {
    const generativeScenes = THE_PARTY_ITACARE_GENERATIVE_VIDEOS.flatMap((video) =>
      video.scenes.filter(
        (scene) => scene.routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
      ),
    );
    expect(generativeScenes.length).toBeGreaterThan(0);
    for (const scene of generativeScenes) {
      const direction = scene.creativeDirection ?? '';
      expect(direction).toContain('factual visual anchor');
      expect(direction).toContain('do not redraw, translate, replace or invent them');
      expect(direction).toContain('publication is not authorized');
    }
  });

  it('keeps every configured output in a review-first duration envelope', () => {
    for (const video of THE_PARTY_ITACARE_GENERATIVE_VIDEOS) {
      expect(video.targetSeconds).toBeGreaterThanOrEqual(8);
      expect(video.targetSeconds).toBeLessThanOrEqual(24);
      expect(video.scenes.length * 8).toBeGreaterThanOrEqual(video.targetSeconds);
    }
  });
});
