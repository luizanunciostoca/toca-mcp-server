import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/security-supply-chain.yml';
const workflow = readFileSync(workflowPath, 'utf8');

describe('Security Supply Chain workflow', () => {
  it('keeps the event-scoped Gitleaks action away from workflow_dispatch refs', () => {
    const eventScopedStep = workflow.indexOf('Scan event-scoped commits for secrets');
    const action = workflow.indexOf('gitleaks/gitleaks-action@', eventScopedStep);
    const fullAncestryStep = workflow.indexOf('Scan complete candidate ancestry for secrets');

    expect(eventScopedStep).toBeGreaterThanOrEqual(0);
    expect(action).toBeGreaterThan(eventScopedStep);
    expect(fullAncestryStep).toBeGreaterThan(action);
    expect(workflow.slice(eventScopedStep, action)).toContain(
      "if: github.event_name != 'workflow_dispatch'",
    );
  });

  it('installs the exact Gitleaks CLI with a pinned SHA-256 before the ancestry scan', () => {
    const installStep = workflow.indexOf(
      'Install verified Gitleaks CLI for exact candidate ancestry',
    );
    const fullAncestryStep = workflow.indexOf('Scan complete candidate ancestry for secrets');

    expect(installStep).toBeGreaterThanOrEqual(0);
    expect(fullAncestryStep).toBeGreaterThan(installStep);
    expect(workflow.slice(installStep, fullAncestryStep)).toContain('VERSION=8.24.3');
    expect(workflow.slice(installStep, fullAncestryStep)).toContain(
      '9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c',
    );
    expect(workflow.slice(installStep, fullAncestryStep)).toContain('sha256sum --check --strict');
    expect(workflow.slice(installStep, fullAncestryStep)).toContain(
      'gitleaks version | grep -F "$VERSION"',
    );
  });

  it('always scans the exact candidate HEAD ancestry and uploads evidence', () => {
    const fullAncestryStep = workflow.indexOf('Scan complete candidate ancestry for secrets');
    const evidenceStep = workflow.indexOf('Upload complete-history secret-scan evidence');

    expect(fullAncestryStep).toBeGreaterThanOrEqual(0);
    expect(evidenceStep).toBeGreaterThan(fullAncestryStep);
    expect(workflow.slice(fullAncestryStep, evidenceStep)).toContain('if: always()');
    expect(workflow.slice(fullAncestryStep, evidenceStep)).toContain('--exit-code=1');
    expect(workflow.slice(fullAncestryStep, evidenceStep)).toContain('--log-opts=HEAD');
    expect(workflow.slice(fullAncestryStep, evidenceStep)).toContain(
      '--report-path=full-history-gitleaks-results.sarif',
    );
    expect(workflow).toContain('gitleaks-full-history-${{ env.CANDIDATE_SHA }}');
    expect(workflow).toContain('if-no-files-found: error');
  });
});
