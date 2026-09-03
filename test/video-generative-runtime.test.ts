import { describe, expect, it } from 'vitest';
import { videoGenerativeRuntimeConfigured } from '../src/mcp/video-generative-runtime.js';

describe('video generative runtime configuration', () => {
  it('accepts Vertex Veo with the attached GCP service identity and no OpenAI secret', () => {
    expect(
      videoGenerativeRuntimeConfigured({
        GCP_PROJECT_ID: 'project',
        INSTAGRAM_PUBLICATION_ASSET_BUCKET: 'bucket',
        VIDEO_SCENE_CONTINUATION_PROVIDER: 'GOOGLE_VERTEX_VEO',
        VIDEO_GOOGLE_AUTH_MODE: 'GCP_SERVICE_IDENTITY',
        VERTEX_VEO_LOCATION: 'us-central1',
        VERTEX_VEO_MODEL: 'veo-3.1-generate-001',
      }),
    ).toBe(true);
  });

  it('accepts explicit short-lived Google access-token bindings for the OpenAI compatibility path', () => {
    expect(
      videoGenerativeRuntimeConfigured({
        GCP_PROJECT_ID: 'project',
        INSTAGRAM_PUBLICATION_ASSET_BUCKET: 'bucket',
        GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY: 'GOOGLE_TOKEN',
        GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY: 'GOOGLE_TOKEN',
        GOOGLE_TOKEN: 'token',
        OPENAI_API_KEY_ENV_KEY: 'OPENAI_TOKEN',
        OPENAI_TOKEN: 'openai-token',
      }),
    ).toBe(true);
  });

  it('accepts renewable AG-01 Google OAuth credentials and its OpenAI provider key', () => {
    expect(
      videoGenerativeRuntimeConfigured({
        GCP_PROJECT_ID: 'project',
        INSTAGRAM_PUBLICATION_ASSET_BUCKET: 'bucket',
        AG01_GOOGLE_OAUTH_CLIENT_ID_ENV_KEY: 'GOOGLE_CLIENT_ID',
        AG01_GOOGLE_OAUTH_CLIENT_SECRET_ENV_KEY: 'GOOGLE_CLIENT_SECRET',
        AG01_GOOGLE_OAUTH_REFRESH_TOKEN_ENV_KEY: 'GOOGLE_REFRESH_TOKEN',
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        GOOGLE_REFRESH_TOKEN: 'refresh-token',
        AG01_OPENAI_API_KEY_ENV_KEY: 'OPENAI_TOKEN',
        OPENAI_TOKEN: 'openai-token',
      }),
    ).toBe(true);
  });

  it('can reuse an AG-01 OpenAI model secret only when the model provider is OpenAI', () => {
    const base = {
      GCP_PROJECT_ID: 'project',
      INSTAGRAM_PUBLICATION_ASSET_BUCKET: 'bucket',
      VIDEO_GOOGLE_OAUTH_CLIENT_ID_ENV_KEY: 'GOOGLE_CLIENT_ID',
      VIDEO_GOOGLE_OAUTH_CLIENT_SECRET_ENV_KEY: 'GOOGLE_CLIENT_SECRET',
      VIDEO_GOOGLE_OAUTH_REFRESH_TOKEN_ENV_KEY: 'GOOGLE_REFRESH_TOKEN',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      GOOGLE_REFRESH_TOKEN: 'refresh-token',
      AG01_MODEL_API_KEY_ENV_KEY: 'MODEL_TOKEN',
      MODEL_TOKEN: 'model-token',
    };
    expect(videoGenerativeRuntimeConfigured({ ...base, AG01_MODEL_PROVIDER: 'openai' })).toBe(true);
    expect(videoGenerativeRuntimeConfigured({ ...base, AG01_MODEL_PROVIDER: 'other' })).toBe(false);
  });

  it('fails closed when Google credentials or OpenAI credentials are incomplete', () => {
    expect(
      videoGenerativeRuntimeConfigured({
        GCP_PROJECT_ID: 'project',
        INSTAGRAM_PUBLICATION_ASSET_BUCKET: 'bucket',
        AG01_GOOGLE_OAUTH_CLIENT_ID_ENV_KEY: 'GOOGLE_CLIENT_ID',
        GOOGLE_CLIENT_ID: 'client-id',
        OPENAI_API_KEY: 'openai-token',
      }),
    ).toBe(false);
  });
});
