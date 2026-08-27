import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/meta-ads-create-paused-provider-smoke.yml',
  'utf8',
);
const entrypoint = readFileSync('src/meta-ads-create-paused-smoke.ts', 'utf8');

describe('Meta Ads provider smoke failure evidence', () => {
  it('emits only a structured sanitized failure marker from the job entrypoint', () => {
    expect(entrypoint).toContain('META_ADS_SMOKE_FAILURE=${JSON.stringify({');
    expect(entrypoint).toContain('errorCode: sanitizeSmokeFailureCode(error)');
    expect(entrypoint).not.toContain('errorCode: normalizeError(error)');
    expect(entrypoint).toContain('error instanceof MetaApiError');
    expect(entrypoint).toContain('META_STATUS_${error.status}');
    expect(entrypoint).toContain('/^[A-Z][A-Z0-9_.:-]{0,199}$/');
    expect(entrypoint).toContain("'META_ADS_SMOKE_UNCLASSIFIED_FAILURE'");
    expect(entrypoint).toContain('secretPayloadDisclosed: false');
    expect(entrypoint).toContain("providerMutationExecuted: mode === 'EXECUTE'");
  });

  it('persists a fail-closed PREPARE artifact before cleanup when the job fails', () => {
    expect(workflow).toContain('EXECUTION_STATUS=0');
    expect(workflow).toContain('|| EXECUTION_STATUS=$?');
    expect(workflow).toContain('textPayload:\\"META_ADS_SMOKE_FAILURE=\\"');
    expect(workflow).toContain('META_ADS_PREPARE_JOB_FAILED_NO_STRUCTURED_RESULT');
    expect(workflow).toContain('.providerMutationExecuted == false');
    expect(workflow).toContain('> meta-ads-provider-prepare-failure.json');
    expect(workflow).toContain("if: always() && steps.request.outputs.phase == 'PREPARE'");
    expect(workflow).toContain('path: meta-ads-provider-prepare*.json');
  });

  it('keeps mutation steps strictly EXECUTE-only', () => {
    expect(workflow).toContain("if: steps.request.outputs.phase == 'EXECUTE'");
    expect(workflow).toContain("if: steps.request.outputs.phase == 'EXECUTE' && success()");
    expect(workflow).toContain('META_ADS_WRITE_ENABLED=false');
  });
});
