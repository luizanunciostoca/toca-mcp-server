import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publisher = readFileSync('.github/workflows/github-native-instagram-publisher.yml', 'utf8');
const stager = readFileSync('.github/workflows/github-native-instagram-stage-asset.yml', 'utf8');
const gcpPublishNow = readFileSync('.github/workflows/marketing-publish-now.yml', 'utf8');
const legacyAutopilot = readFileSync(
  '.github/workflows/marketing-autopilot-publication.yml',
  'utf8',
);
const runtime = readFileSync(
  'src/github-native-publication/github-native-publication-runtime.ts',
  'utf8',
);

describe('GitHub-native Instagram publication boundary', () => {
  it('keeps the GitHub-native scheduler outside the top-of-hour hotspot in America/Bahia', () => {
    expect(publisher).toContain("cron: '2/5 * * * *'");
    expect(publisher).toContain("timezone: 'America/Bahia'");
  });

  it('has no Google Cloud execution or identity dependency', () => {
    for (const content of [publisher, stager]) {
      expect(content).not.toContain('google-github-actions/');
      expect(content).not.toContain('gcloud ');
      expect(content).not.toContain('id-token: write');
      expect(content).not.toContain('Cloud Run');
      expect(content).not.toContain('Cloud SQL');
      expect(content).not.toContain('GCS');
    }
    expect(runtime).toContain("publicationAssetHost = 'raw.githubusercontent.com'");
  });

  it('removes the GitHub-native provider write dispatch surface while preserving asset staging', () => {
    expect(publisher).not.toContain('repository_dispatch:');
    expect(publisher).not.toContain('github-native-instagram-publish-controlled');
    expect(stager).toContain('repository_dispatch:');
    expect(stager).toContain('github-native-instagram-stage-asset');
    expect(publisher).not.toContain('workflow_dispatch:');
    expect(stager).not.toContain('workflow_dispatch:');
    expect(publisher).toContain('test "${GITHUB_REF}" = "refs/heads/${DEFAULT_BRANCH}"');
    expect(stager).toContain('test "${GITHUB_REF}" = "refs/heads/${DEFAULT_BRANCH}"');
  });

  it('pins GitHub-native publication to read-only SHADOW regardless of repository variables', () => {
    expect(publisher).toContain('TOCA_GITHUB_NATIVE_PUBLICATION_MODE: SHADOW');
    expect(publisher).toContain("TOCA_GITHUB_NATIVE_PUBLICATION_WRITES_ENABLED: 'false'");
    expect(publisher).toContain("TOCA_GITHUB_NATIVE_MANUAL_WRITE_CONFIRMATION: 'false'");
    expect(publisher).not.toContain('vars.TOCA_GITHUB_NATIVE_PUBLICATION_MODE');
    expect(publisher).not.toContain('vars.TOCA_GITHUB_NATIVE_PUBLICATION_WRITES_ENABLED');
    expect(publisher).toContain(
      'INSTAGRAM_BUSINESS_ACCOUNT_ID: ${{ vars.INSTAGRAM_BUSINESS_ACCOUNT_ID }}',
    );
    expect(publisher).not.toContain("INSTAGRAM_BUSINESS_ACCOUNT_ID || '17841402033495654'");
    expect(publisher.match(/META_ACCESS_TOKEN:/g)).toHaveLength(1);
    expect(publisher).toContain('TOCA_GITHUB_NATIVE_CONTROLLER_SHA: ${{ github.sha }}');
    expect(runtime).toContain('GITHUB_NATIVE_CONTROLLER_SHA_REQUIRED');
    expect(runtime).toContain('GITHUB_NATIVE_PUBLICATION_WRITES_DISABLED');
    expect(runtime).toContain('GITHUB_NATIVE_MANUAL_WRITE_CONFIRMATION_REQUIRED');
    expect(runtime).toContain('GITHUB_NATIVE_ASSET_SHA256_MISMATCH');
    expect(runtime).toContain('GITHUB_NATIVE_CREATIVE_TRUTH_HASH_MISMATCH');
    expect(runtime).not.toContain('TOCA_PUBLICATION_NOW');
  });

  it('persists state only to the dedicated publication-state branch', () => {
    expect(publisher).toContain('ref: publication-state');
    expect(publisher).toContain('git -C "$ledger" add -- publication-state');
    expect(publisher).toContain('git -C "$ledger" push origin HEAD:publication-state');
  });

  it('stages only content-addressed JPEGs and validates redirect targets', () => {
    expect(stager).toContain('ref: publication-assets');
    expect(stager).toContain("host.endsWith('.storage.googleapis.com')");
    expect(stager).toContain('effective_url=');
    expect(stager).toContain('sha256sum "$work/asset.jpg"');
    expect(stager).toContain('test "$magic" = "ffd8ff"');
    expect(stager).toContain('publication-assets/${sha}.jpg');
    expect(stager).toContain('raw.githubusercontent.com');
  });

  it('activates the governed GCP publish-now lane only through protected command state', () => {
    expect(gcpPublishNow).not.toContain('ALLOW_LEGACY_GCP_MARKETING_PUBLISH_NOW');
    expect(gcpPublishNow).toContain("if: steps.command.outputs.action == 'PUBLISH_NOW'");
    expect(gcpPublishNow).toContain('target_code_sha=$(jq -r .targetCodeSha');
    expect(gcpPublishNow).toContain(
      'GITHUB_SHA="$AUDITED_CODE_SHA" bash scripts/marketing-publish-now-fixed.sh',
    );
  });

  it('keeps the command-file GCP autopilot lane retired with no cloud or provider side effects', () => {
    expect(legacyAutopilot).toContain('LEGACY_GCP_MARKETING_AUTOPILOT_PUBLICATION=RETIRED');
    expect(legacyAutopilot).not.toContain('google-github-actions/');
    expect(legacyAutopilot).not.toContain('gcloud ');
    expect(legacyAutopilot).not.toContain('id-token: write');
    expect(legacyAutopilot).not.toContain('META_ACCESS_TOKEN');
    expect(legacyAutopilot).not.toContain('Cloud Run jobs deploy');
  });
});
