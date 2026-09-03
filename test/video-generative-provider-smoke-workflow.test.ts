import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const smokeWorkflow = readFileSync('.github/workflows/video-generative-provider-smoke.yml', 'utf8');
const dispatchWorkflow = readFileSync(
  '.github/workflows/video-generative-provider-smoke-autodispatch.yml',
  'utf8',
);
const runner = readFileSync('src/video-generative-provider-smoke.ts', 'utf8');

describe('video generative provider smoke', () => {
  it('is hard-bound to the approved source/content and remains publication closed', () => {
    expect(runner).toContain("'VID-TP-20260904-DUAS-PISTAS-GEN-001'");
    expect(runner).toContain("'TP-GEN-0001'");
    expect(runner).toContain("'e16d4bc9dba27eb60a826d9be6fd3dade2f1e2e48445e1155a421cf52ca7d85b'");
    expect(runner).toContain("routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO'");
    expect(runner).toContain("result.manifest.provider !== 'OPENAI_VIDEO_API'");
    expect(runner).toContain('publicationAuthorized: false');
  });

  it('requires an owner-authored exact-main authorization issue before dispatch', () => {
    expect(dispatchWorkflow).toContain('issues:');
    expect(dispatchWorkflow).toContain('types: [opened]');
    expect(dispatchWorkflow).toContain('github.event.issue.user.login == github.repository_owner');
    expect(dispatchWorkflow).toContain('AUTHORIZED_CANDIDATE_SHA=$GITHUB_SHA');
    expect(dispatchWorkflow).toContain('VIDEO_CONTENT_ITEM_ID=VID-TP-20260904-DUAS-PISTAS-GEN-001');
    expect(dispatchWorkflow).toContain('PUBLICATION_AUTHORIZED=false');
  });

  it('uses the canonical production publication bucket without dynamic resource discovery', () => {
    expect(smokeWorkflow).toContain(
      "vars.INSTAGRAM_PUBLICATION_ASSET_BUCKET || 'toca-mcp-publication-assets'",
    );
    expect(smokeWorkflow).not.toContain('gcloud run services describe');
    expect(smokeWorkflow).not.toContain('gcloud storage buckets list');
  });

  it('runs generation only under the production runtime identity and uploads review evidence', () => {
    expect(smokeWorkflow).toContain('environment: production');
    expect(smokeWorkflow).toContain('--service-account "$GCP_RUNTIME_SERVICE_ACCOUNT"');
    expect(smokeWorkflow).toContain('dist/src/video-generative-provider-smoke.js');
    expect(smokeWorkflow).toContain('VIDEO_GENERATIVE_PROVIDER_SMOKE_RESULT=');
    expect(smokeWorkflow).toContain('publicationEligible == false');
    expect(smokeWorkflow).toContain('publicationAuthorized == false');
    expect(smokeWorkflow).toContain(
      'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    );
  });
});
