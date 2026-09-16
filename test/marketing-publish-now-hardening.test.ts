import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/marketing-publish-now.yml', 'utf8');
const script = readFileSync('scripts/marketing-publish-now.sh', 'utf8');
const wrapper = readFileSync('scripts/marketing-publish-now-fixed.sh', 'utf8');
const brandGate = readFileSync('scripts/check-publish-now-brand-determinism.mjs', 'utf8');
const rightsGate = readFileSync('scripts/check-publish-now-rights-clearance.mjs', 'utf8');

describe('Marketing Publish Now hardening contract', () => {
  it('uses the WIF access token for Docker and the exact Drive asset download', () => {
    expect(workflow).not.toContain('gcloud auth configure-docker');
    expect(script).toContain('docker login -u oauth2accesstoken --password-stdin');
    expect(script).toContain('Authorization: Bearer ${GOOGLE_ACCESS_TOKEN}');
    expect(script).toContain('drive/v3/files/${DRIVE_FILE_ID}?alt=media');
    expect(script).toContain('test "$SOURCE_ASSET_SHA256" = "$EXPECTED_ASSET_SHA256"');
  });

  it('binds Creative Truth to the exact approved asset before preparation', () => {
    expect(script).toContain('.creativeTruthBinding.outputSha256 == .expectedAssetSha256');
    expect(script).toContain('.manifest.request.publicationAssetSha256 == $sourceSha');
    expect(script).toContain('.manifest.request.creativeTruthBinding.outputSha256 == $sourceSha');
  });

  it('pushes candidate images, resolves registry digests, and deploys immutable references', () => {
    expect(script).toContain('retry_command 3 5 docker push "$app_image_tag"');
    expect(script).toContain('retry_command 3 5 docker push "$prep_image_tag"');
    expect(script).toContain('gcloud artifacts docker images describe "$app_image_tag"');
    expect(script).toContain('gcloud artifacts docker images describe "$prep_image_tag"');
    expect(script).toContain('APP_IMAGE="${app_image_tag%:*}@${APP_IMAGE_DIGEST}"');
    expect(script).toContain('PREP_IMAGE="${prep_image_tag%:*}@${PREP_IMAGE_DIGEST}"');
    expect(script).toContain('[[ "$APP_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]');
    expect(script).toContain('[[ "$PREP_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]');
    expect(script).toContain('--image "$APP_IMAGE"');
    expect(script).toContain('--image "$PREP_IMAGE"');
  });

  it('executes the hardened-source preflight without provider access', () => {
    const result = spawnSync('bash', ['scripts/marketing-publish-now-fixed.sh'], {
      cwd: process.cwd(),
      env: { ...process.env, PUBLISH_NOW_PATCH_ONLY: 'true' },
      encoding: 'utf8',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stderr).toContain('P1_WRAPPER_PHASE=START');
    expect(result.stderr).toContain('P1_WRAPPER_PHASE=SOURCE_VERIFIED');
    expect(result.stderr).toContain('P1_HARDENED_SOURCE=PASS');
    expect(result.stderr).toContain('P1_WRAPPER_PHASE=PATCH_ONLY_COMPLETE');
    expect(result.stderr).not.toContain('P1_PHASE=AUTHENTICATE_DOCKER');
  });

  it('pins both Cloud SQL database secret mounts to the approved version', () => {
    expect(workflow).toContain("DATABASE_SECRET_VERSION: '1'");
    expect(
      script.match(/DATABASE_URL=\$DATABASE_SECRET_ID:\$DATABASE_SECRET_VERSION/g),
    ).toHaveLength(2);
    expect(script).not.toContain('DATABASE_URL=$DATABASE_SECRET_ID:latest');
    expect(wrapper).toContain('expected exactly two pinned database secret references');
    expect(wrapper).toContain('FAIL_CLOSED: unpinned database secret reference present');
  });

  it('uses the runtime audited SHA without overriding the GitHub runner SHA', () => {
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$AUDITED_CODE_SHA"');
    expect(workflow).toContain(
      'GITHUB_SHA="$AUDITED_CODE_SHA" bash scripts/marketing-publish-now-fixed.sh',
    );
    expect(workflow).not.toContain('GITHUB_SHA: ${{ env.AUDITED_CODE_SHA }}');
  });

  it('fails closed before cloud authentication when deterministic brand truth is absent', () => {
    const brandStep = workflow.indexOf('Verify deterministic brand binding');
    const authStep = workflow.indexOf('Authenticate to Google Cloud and Drive');

    expect(brandStep).toBeGreaterThan(-1);
    expect(authStep).toBeGreaterThan(brandStep);
    expect(workflow).toContain('node scripts/check-publish-now-brand-determinism.mjs');
    expect(brandGate).toContain('BRAND_DETERMINISM_REQUIRED');
    expect(brandGate).toContain('BRAND_DETERMINISM_NOT_VERIFIED');
    expect(brandGate).toContain('BRAND_DETERMINISM_TYPOGRAPHY_REQUIRED');
    expect(brandGate).toContain('BRAND_DETERMINISM_ASSET_BINDING_MISMATCH');
  });

  it('fails closed before cloud authentication when rights clearance is absent or stale', () => {
    const rightsStep = workflow.indexOf('Verify rights clearance gate');
    const authStep = workflow.indexOf('Authenticate to Google Cloud and Drive');

    expect(rightsStep).toBeGreaterThan(-1);
    expect(authStep).toBeGreaterThan(rightsStep);
    expect(workflow).toContain('node scripts/check-publish-now-rights-clearance.mjs');
    expect(rightsGate).toContain('RIGHTS_CLEARANCE_REQUIRED');
    expect(rightsGate).toContain('RIGHTS_CLEARANCE_NOT_CLEARED');
    expect(rightsGate).toContain('RIGHTS_CLEARANCE_ASSET_BINDING_MISMATCH');
    expect(rightsGate).toContain('RIGHTS_CLEARANCE_EXPIRED');
    expect(rightsGate).toContain("clearance.scope === 'INSTAGRAM_ORGANIC_PUBLICATION'");
  });

  it('disables and verifies write capability before and after provider readback', () => {
    const attempt = script.indexOf('EXECUTE_ATTEMPTED=1');
    const execute = script.indexOf('gcloud run jobs execute "$EXECUTE_JOB_NAME"', attempt);
    const disable = script.indexOf('disable_writes', execute);
    const readback = script.indexOf('run_provider_readback', disable);
    const finalDisable = script.indexOf('verify_writes_disabled', readback);

    expect(attempt).toBeGreaterThan(-1);
    expect(execute).toBeGreaterThan(attempt);
    expect(disable).toBeGreaterThan(execute);
    expect(readback).toBeGreaterThan(disable);
    expect(finalDisable).toBeGreaterThan(readback);
    expect(script).not.toContain('disable_writes || true');
    expect(script).toContain('disableExitCode:$disableExitCode');
    expect(script).toContain('finalDisableVerificationExitCode:$finalDisableVerificationExitCode');
    expect(script).toContain(
      'writeCapabilityDisabledAfterAttempt:$writeCapabilityDisabledAfterAttempt',
    );
    expect(script).toContain('finalWriteCapabilityDisabled:$finalWriteCapabilityDisabled');
    expect(script).toContain('PUBLISHED_VERIFIED_AFTER_EXECUTE_ERROR');
    expect(script).toContain('RECONCILIATION_REQUIRED');
  });

  it('uploads evidence even when the hardened execution step fails', () => {
    expect(workflow).toContain("if: always() && steps.command.outputs.action == 'PUBLISH_NOW'");
    expect(workflow).toContain('marketing-publish-now-*.json');
    expect(script).toContain('providerReadbackAttempted:true');
    expect(script).toContain('appImage:$appImage');
    expect(script).toContain('prepareImage:$prepareImage');
  });
});
