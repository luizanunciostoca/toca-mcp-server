import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/security-supply-chain.yml', 'utf8');

describe('Security Supply Chain registry resilience', () => {
  it('classifies only known npm audit transport failures for Trivy fallback', () => {
    for (const marker of [
      'PNPM_AUDIT_STATUS=INFRA_UNAVAILABLE_TRIVY_FALLBACK',
      'ERR_SOCKET_TIMEOUT',
      'ECONNRESET',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENOTFOUND',
      'ERR_PNPM_META_FETCH_FAIL',
      'registry\\.npmjs\\.org/-/npm/v1/security/audits failed',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('keeps vulnerability and unclassified audit failures fail-closed', () => {
    expect(workflow).toContain('PNPM_AUDIT_STATUS=VULNERABILITY_OR_UNCLASSIFIED_FAILURE');
    expect(workflow).toContain('exit "$AUDIT_RC"');
    expect(workflow).not.toContain('pnpm audit --audit-level high || true');
  });

  it('requires independent Trivy HIGH/CRITICAL coverage when npm audit infrastructure is unavailable', () => {
    for (const marker of [
      'id: trivy_fs',
      "severity: 'CRITICAL,HIGH'",
      'TRIVY_FS_OUTCOME: ${{ steps.trivy_fs.outcome }}',
      'test "$TRIVY_FS_OUTCOME" = \'success\'',
      'PNPM_AUDIT_FALLBACK_TRIVY=PASS',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('prevents an earlier audit failure from suppressing Gitleaks evidence', () => {
    expect(workflow).toContain("if: github.event_name != 'workflow_dispatch' && always()");
    expect(workflow).toContain(
      'Install verified Gitleaks CLI for exact candidate ancestry\n        if: always()',
    );
    expect(workflow).toContain(
      'Scan complete candidate ancestry for secrets\n        if: always()',
    );
    expect(workflow).toContain(
      'Upload complete-history secret-scan evidence\n        if: always()',
    );
  });
});
