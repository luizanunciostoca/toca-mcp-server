import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/ag01-grounded-runtime-activation-v2.yml',
  'utf8',
);

describe('AG-01 grounded runtime activation V2', () => {
  it('separates process startup from dependency readiness without widening authority', () => {
    expect(workflow).toContain("--startup-probe 'httpGet.path=/healthz");
    expect(workflow).toContain('READINESS_GATE_PATH=/ready');
    expect(workflow).toContain('PROVIDER_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('DIRECT_PROVIDER_WRITE_AUTHORIZED=false');
    expect(workflow).toContain('EXTERNAL_BUSINESS_SIDE_EFFECTS_AUTHORIZED=false');
    expect(workflow).toContain('--no-traffic --no-allow-unauthenticated');
    expect(workflow).toContain('AG01_READINESS_ERROR_CODE=');
    expect(workflow).toContain('steps.promote.outputs.traffic_changed');
    expect(workflow).toContain('DRIVE_SCOPE=READ_ONLY');
    expect(workflow).not.toContain('--allow-unauthenticated');
  });

  it('permits controller-only drift from the already built runtime source', () => {
    expect(workflow).toContain('AUTHORIZED_RUNTIME_SOURCE_SHA=');
    expect(workflow).toContain('AUTHORIZED_IMAGE_DIGEST=');
    expect(workflow).toContain('Unapproved runtime drift path');
    expect(workflow).toContain(
      '.github/workflows/ag01-grounded-runtime-activation-v2.yml|test/ag01-grounded-runtime-activation-v2.test.ts',
    );
  });
});
