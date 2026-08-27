import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/marketing-publish-now.yml', 'utf8');
const script = readFileSync('scripts/marketing-publish-now.sh', 'utf8');

describe('Marketing Publish Now hardening contract', () => {
  it('uses the WIF access token directly for Docker and retries both pushes', () => {
    expect(workflow).not.toContain('gcloud auth configure-docker');
    expect(script).toContain('docker login -u oauth2accesstoken --password-stdin');
    expect(script).toContain('retry_command 3 5 docker push "$APP_IMAGE"');
    expect(script).toContain('retry_command 3 5 docker push "$PREP_IMAGE"');
  });

  it('binds Creative Truth to the exact approved asset before preparation', () => {
    expect(script).toContain('.creativeTruthBinding.outputSha256 == .expectedAssetSha256');
    expect(script).toContain('.manifest.request.publicationAssetSha256 == $sourceSha');
    expect(script).toContain('.manifest.request.creativeTruthBinding.outputSha256 == $sourceSha');
  });

  it('always performs provider readback after a side-effect attempt, even when execute fails', () => {
    const attempt = script.indexOf('EXECUTE_ATTEMPTED=1');
    const execute = script.indexOf('gcloud run jobs execute "$EXECUTE_JOB_NAME"', attempt);
    const disable = script.indexOf('disable_writes || true', execute);
    const readback = script.indexOf('run_provider_readback', disable);

    expect(attempt).toBeGreaterThan(-1);
    expect(execute).toBeGreaterThan(attempt);
    expect(disable).toBeGreaterThan(execute);
    expect(readback).toBeGreaterThan(disable);
    expect(script).toContain('PUBLISHED_VERIFIED_AFTER_EXECUTE_ERROR');
    expect(script).toContain('RECONCILIATION_REQUIRED');
  });

  it('uploads evidence even when the hardened execution step fails', () => {
    expect(workflow).toContain("if: always() && steps.command.outputs.action == 'PUBLISH_NOW'");
    expect(workflow).toContain('marketing-publish-now-*.json');
    expect(script).toContain('providerReadbackAttempted:true');
    expect(script).toContain('writeCapabilityDisabledAfterAttempt:true');
  });
});
