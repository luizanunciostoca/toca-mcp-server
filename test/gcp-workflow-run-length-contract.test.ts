import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');
const GITHUB_RUN_COMMAND_LIMIT = 21_000;

type RunBlock = { line: number; length: number; preview: string };

function extractRunBlocks(source: string): RunBlock[] {
  const lines = source.split('\n');
  const blocks: RunBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*[|>]\s*$/.exec(lines[index] ?? '');
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
      const indent = /^(\s*)/.exec(line)?.[1]?.length ?? 0;
      if (indent <= keyIndent) break;
      body.push(line.slice(Math.min(line.length, keyIndent + 2)));
    }

    const command = body.join('\n');
    blocks.push({
      line: index + 1,
      length: command.length,
      preview: command.trimStart().split('\n')[0]?.slice(0, 100) ?? '',
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
