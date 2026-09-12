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
    const finalIds = THE_PARTY_ITACARE_GENERATIVE_VIDEOS.map((video) => video.finalContentItemId);
    expect(new Set(sceneIds).size).toBe(sceneIds.length);
    expect(new Set(finalIds).size).toBe(finalIds.length);
  });

  it('pins every source to the exact governed Drive file and sha256 digest', () => {
    expect(THE_PARTY_ITACARE_SOURCES).toEqual({
      VENUE_DAY: {
        assetId: 'TP-ITA-GEN-VENUE-DAY-001',
        venueAssetId: 'VENUE-TP-ITA-GEN-VENUE-DAY-001',
        driveFileId: '1Yb0_x2eh-gUDo0S-GrZ2Y9FKv3t6ZDmD',
        sha256: '132a24cc60893abb132232c5a473ae42fb7fe7c5fd8f296b2ea546921c6e7047',
        containsPeople: false,
        approvedRoutes: ['GENERATIVE_SCENE_CONTINUATION_VIDEO'],
      },
      VENUE_SUNSET: {
        assetId: 'TP-ITA-GEN-VENUE-SUNSET-001',
        venueAssetId: 'VENUE-TP-ITA-GEN-VENUE-SUNSET-001',
        driveFileId: '1zLjYNjr3xP4uaBcCLQEY9jKbHOaKlN50',
        sha256: 'a0ed04a0e9168e7f07b4094f3bfecd605707d55c57927e9fd5af6b1493943379',
        containsPeople: false,
        approvedRoutes: ['GENERATIVE_SCENE_CONTINUATION_VIDEO'],
      },
      ILLUSIONIZE: {
        assetId: 'TP-ITA-PHOTO-ILLUSIONIZE-001',
        venueAssetId: 'VENUE-TP-ITA-PHOTO-ILLUSIONIZE-001',
        driveFileId: '1dOP5xiNx3iI9fZStm47BTq737wtA2Wst',
        sha256: '5a8e519354a04d1d4c11547f323a3641c70ae736779538013d9a3d49e1f31ca0',
        containsPeople: true,
        approvedRoutes: ['REAL_PHOTO_TO_MOTION_VIDEO'],
      },
      BRISOTTI: {
        assetId: 'TP-ITA-PHOTO-BRISOTTI-001',
        venueAssetId: 'VENUE-TP-ITA-PHOTO-BRISOTTI-001',
        driveFileId: '1-Pl_A32eLNgbhZDZVb77uUGE0RZz7tfj',
        sha256: '4de8d4b015bc58d425b46b6a689c2245bc9093ac629bc485f967fa8a88f09aa5',
        containsPeople: true,
        approvedRoutes: ['REAL_PHOTO_TO_MOTION_VIDEO'],
      },
      LINEUP_DUO: {
        assetId: 'TP-ITA-PHOTO-LINEUP-DUO-001',
        venueAssetId: 'VENUE-TP-ITA-PHOTO-LINEUP-DUO-001',
        driveFileId: '1SKt19Uu5GNC942aS8lWnrdhsV3QpHYAY',
        sha256: '2f704e3b82cd6ff808a110e344a73472ae3a5f96d769bebb052829f367a0984d',
        containsPeople: true,
        approvedRoutes: ['REAL_PHOTO_TO_MOTION_VIDEO'],
      },
    });
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
      video.scenes.filter((scene) => scene.routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO'),
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
