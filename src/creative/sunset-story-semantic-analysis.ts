import type {
  NormalizedRect,
  SunsetStorySceneClass,
  SunsetStorySubjectKind,
} from './sunset-story-image-profile.js';

export interface SunsetStorySemanticSubject {
  readonly kind: SunsetStorySubjectKind;
  readonly box: NormalizedRect;
  readonly salience: number;
}

export interface SunsetStorySemanticObservation {
  readonly subjects: readonly SunsetStorySemanticSubject[];
  readonly horizonY: number | null;
  readonly sceneHints: readonly SunsetStorySceneClass[];
}

export interface SunsetStorySemanticAnalyzerRequest {
  readonly assetId: string;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface SunsetStorySemanticAnalyzerPort {
  analyzeSemantic(
    request: SunsetStorySemanticAnalyzerRequest,
  ): Promise<SunsetStorySemanticObservation>;
}
