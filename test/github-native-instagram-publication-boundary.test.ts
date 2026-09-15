import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publisher = readFileSync('.github/workflows/github-native-instagram-publisher.yml', 'utf8');
const stager = readFileSync('.github/workflows/github-native-instagram-stage-asset.yml', 'utf8');
const canaryBridge = readFileSync(
  '.github/workflows/github-native-instagram-canary-secret-bridge.yml',
  'utf8',
);
const legacyPublishNow = readFileSync('.github/workflows/marketing-publish-now.yml', 'utf8');
const legacyAutopilot = readFileSync(
  '.github/workflows/marketing-autopilot-publication.yml',
  'utf8',
);
const runtime = readFileSync(
  'src/github-native-publication/github-native-publication-runtime.ts',
  'utf8',
);

describe('GitHub-native Instagram publication boundary', () => {
  it('schedules outside the top-of-hour hotspot in America/Bahia', () => {
    expect(publisher).toContain("cron: '2/5 * * * *'");
    expect(publisher).toContain("timezone: 'America/Bahia'");
  });

  it('has no Google Cloud execution or identity dependency in the canonical lane', () => {
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

  it('executes write-capable dispatches only from default-branch repository_dispatch', () => {
    expect(publisher).toContain('repository_dispatch:');
    expect(publisher).toContain('github-native-instagram-publish-controlled');
    expect(stager).toContain('repository_dispatch:');
    expect(stager).toContain('github-native-instagram-stage-asset');
    expect(publisher).not.toContain('workflow_dispatch:');
    expect(stager).not.toContain('workflow_dispatch:');
    expect(publisher).toContain('test "${GITHUB_REF}" = "refs/heads/${DEFAULT_BRANCH}"');
    expect(stager).toContain('test "${GITHUB_REF}" = "refs/heads/${DEFAULT_BRANCH}"');
  });

  it('keeps provider writes fail-closed and SHA-bound', () => {
    expect(publisher).toContain("vars.TOCA_GITHUB_NATIVE_PUBLICATION_MODE || 'SHADOW'");
    expect(publisher).toContain("vars.TOCA_GITHUB_NATIVE_PUBLICATION_WRITES_ENABLED || 'false'");
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

  it('keeps the temporary canary bridge one-shot, runtime-only, and readback-gated', () => {
    expect(canaryBridge).toContain('push:');
    expect(canaryBridge).not.toContain('schedule:');
    expect(canaryBridge).not.toContain('repository_dispatch:');
    expect(canaryBridge).not.toContain('workflow_dispatch:');
    expect(canaryBridge).toContain(
      "if: github.event.before == '69f388b2726b64f622b7fb2e51a65460b68e7022'",
    );
    expect(canaryBridge).toContain('environment: production');
    expect(canaryBridge).toContain(
      'GCP_RUNTIME_SERVICE_ACCOUNT: toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com',
    );
    expect(canaryBridge).toContain(
      'service_account: ${{ env.GCP_RUNTIME_SERVICE_ACCOUNT }}',
    );
    expect(canaryBridge).not.toContain('toca-mcp-deployer@');
    expect(canaryBridge).not.toContain('toca-mcp-infra-admin@');
    expect(canaryBridge).toContain('GCP_META_TOKEN_SECRET_ID: toca-meta-oauth-token');
    expect(canaryBridge).toContain('item_count=');
    expect(canaryBridge).toContain('PUBLISHED_AND_READBACK_VERIFIED');
    expect(canaryBridge).toContain('RECONCILED_ALREADY_PUBLISHED_READBACK_VERIFIED');
  });

  it('keeps the older publish-now GCP lane disabled unless explicitly re-authorized', () => {
    expect(legacyPublishNow).toContain("if: vars.ALLOW_LEGACY_GCP_MARKETING_PUBLISH_NOW == 'true'");
  });

  it('retires the command-file GCP autopilot lane with no cloud or provider side effects', () => {
    expect(legacyAutopilot).toContain('LEGACY_GCP_MARKETING_AUTOPILOT_PUBLICATION=RETIRED');
    expect(legacyAutopilot).toContain('github-native-instagram-publisher.yml');
    expect(legacyAutopilot).not.toContain('google-github-actions/');
    expect(legacyAutopilot).not.toContain('gcloud ');
    expect(legacyAutopilot).not.toContain('id-token: write');
    expect(legacyAutopilot).not.toContain('META_ACCESS_TOKEN');
    expect(legacyAutopilot).not.toContain('Cloud Run jobs deploy');
  });
});
