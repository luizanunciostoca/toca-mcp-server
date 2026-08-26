from pathlib import Path

workflow_path = Path('.github/workflows/deploy-gcp.yml')
text = workflow_path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    '''      - name: Verify health readiness and webhook route confinement
        if: inputs.operation == 'deploy'
        env:
          MCP_TOKEN: ${{ steps.mcp_probe_auth.outputs.id_token }}
          MCP_AUDIENCE: ${{ steps.resolve_candidates.outputs.mcp_audience }}
          WEBHOOK_TOKEN: ${{ steps.webhook_probe_auth.outputs.id_token }}
        run: |
''',
    '''      - name: Verify MCP health readiness and internal acceptance
        if: inputs.operation == 'deploy'
        env:
          MCP_TOKEN: ${{ steps.mcp_probe_auth.outputs.id_token }}
          MCP_AUDIENCE: ${{ steps.resolve_candidates.outputs.mcp_audience }}
        run: |
''',
    'MCP verification step header',
)

split_marker = '''            jq -e '.status == "ready" and (.checks | all(.ok == true))' platform-evidence/mcp-readyz.json >/dev/null
          fi

          if [[ "$DEPLOY_ENVIRONMENT" == production ]]; then
            test -n "$WEBHOOK_REVISION" || { echo 'Webhook exact candidate revision missing' >&2; exit 1; }
'''

split_replacement = '''            jq -e '.status == "ready" and (.checks | all(.ok == true))' platform-evidence/mcp-readyz.json >/dev/null
          fi

      - name: Verify production webhook health readiness and route confinement
        if: inputs.operation == 'deploy'
        env:
          WEBHOOK_TOKEN: ${{ steps.webhook_probe_auth.outputs.id_token }}
        run: |
          set -euo pipefail
          mkdir -p platform-evidence

          if [[ "$DEPLOY_ENVIRONMENT" == production ]]; then
            test -n "$WEBHOOK_REVISION" || { echo 'Webhook exact candidate revision missing' >&2; exit 1; }
'''
replace_once(split_marker, split_replacement, 'MCP/webhook run-step split')

replace_once(
    '''                status="$(gcloud logging read \\
                  "resource.type="cloud_scheduler_job" AND resource.labels.job_id="${job}" AND httpRequest.status>0" \\
''',
    '''                status="$(gcloud logging read \\
                  "resource.type=\\"cloud_scheduler_job\\" AND resource.labels.job_id=\\"${job}\\" AND httpRequest.status>0" \\
''',
    'Cloud Scheduler log filter quoting',
)

workflow_path.write_text(text)

for test_name in (
    'test/gcp-deploy-cloud-run-probes.test.ts',
    'test/gcp-production-internal-probe-contract.test.ts',
    'test/gcp-production-probe-rollback-contract.test.ts',
    'test/gcp-production-webhook-internal-probe-contract.test.ts',
):
    path = Path(test_name)
    source = path.read_text()
    old = '- name: Verify health readiness and webhook route confinement'
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{test_name}: expected one old verification marker, found {count}')
    path.write_text(source.replace(old, '- name: Verify MCP health readiness and internal acceptance', 1))

limit_test = Path('test/gcp-workflow-run-length-contract.test.ts')
limit_test.write_text('''import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');
const GITHUB_RUN_COMMAND_LIMIT = 21_000;

type RunBlock = { line: number; length: number; preview: string };

function extractRunBlocks(source: string): RunBlock[] {
  const lines = source.split('\\n');
  const blocks: RunBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\\s*)run:\\s*[|>]\\s*$/.exec(lines[index] ?? '');
    if (!match) continue;

    const keyIndent = match[1]?.length ?? 0;
    const body: string[] = [];
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? '';
      if (line.trim() === '') {
        body.push('');
        continue;
      }
      const indent = /^(\\s*)/.exec(line)?.[1]?.length ?? 0;
      if (indent <= keyIndent) break;
      body.push(line.slice(Math.min(line.length, keyIndent + 2)));
    }

    const command = body.join('\\n');
    blocks.push({
      line: index + 1,
      length: command.length,
      preview: command.trimStart().split('\\n')[0]?.slice(0, 100) ?? '',
    });
    index = cursor - 1;
  }

  return blocks;
}

describe('Deploy GCP workflow run command size contract', () => {
  it('keeps every run block within the GitHub Actions 21,000-character limit', () => {
    const blocks = extractRunBlocks(workflow);
    expect(blocks.length).toBeGreaterThan(0);
    const oversized = blocks.filter((block) => block.length > GITHUB_RUN_COMMAND_LIMIT);
    expect(oversized).toEqual([]);
  });

  it('keeps MCP and production webhook acceptance in separate run steps', () => {
    expect(workflow).toContain('- name: Verify MCP health readiness and internal acceptance');
    expect(workflow).toContain(
      '- name: Verify production webhook health readiness and route confinement',
    );
  });
});
''')
