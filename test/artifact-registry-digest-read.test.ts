import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = 'scripts/resolve-artifact-registry-digest.sh';
const prefix = 'southamerica-east1-docker.pkg.dev/toca-mcp-production/toca-mcp/';
const digest = 'sha256:' + 'a'.repeat(64);
const manifest = (sha = digest) =>
  JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    digest: sha,
  });

function run({
  ref = prefix + 'ag01:grounded-candidate',
  tag = manifest(),
  immutable = manifest(),
  denied = false,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'registry-digest-test-'));
  const calls = join(directory, 'calls');
  writeFileSync(
    join(directory, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
test "$1 $2 $3" = 'buildx imagetools inspect'
test "$5" = --format
test "$6" = '{{json .Manifest}}'
printf '%s\\n' "$4" >> "$DIGEST_TEST_CALLS"
if [[ "$DIGEST_TEST_DENIED" == true ]]; then echo 'PRIVATE-REGISTRY-ERROR' >&2; exit 13; fi
if [[ "$4" == *@* ]]; then printf '%s' "$DIGEST_TEST_IMMUTABLE"; else printf '%s' "$DIGEST_TEST_TAG"; fi
`,
    { mode: 0o700 },
  );
  try {
    const result = spawnSync('bash', [script, ref], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: directory + ':' + process.env.PATH,
        DIGEST_TEST_CALLS: calls,
        DIGEST_TEST_DENIED: String(denied),
        DIGEST_TEST_TAG: tag,
        DIGEST_TEST_IMMUTABLE: immutable,
      },
    });
    if (result.error) throw result.error;
    return {
      ...result,
      calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [],
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('registry-only immutable digest resolution', () => {
  it('reads the exact tag and independently verifies its immutable reference', () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(digest + '\n');
    expect(result.calls).toEqual([prefix + 'ag01:grounded-candidate', prefix + 'ag01@' + digest]);
  });

  it('verifies digest references and OCI/index media without reading analysis metadata', () => {
    const result = run({ ref: prefix + 'server@' + digest });
    expect(result.status).toBe(0);
    expect(result.calls).toEqual([prefix + 'server@' + digest]);
    const index = JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.index.v1+json',
      digest,
    });
    expect(run({ tag: index, immutable: index }).status).toBe(0);
  });

  it('fails on denied access without changing identities, retrying or publishing raw errors', () => {
    const result = run({ denied: true });
    expect(result.status).not.toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('REGISTRY_MANIFEST_READ_FAILED\n');
  });

  it('rejects mismatched immutable results and malformed or nested-only digest evidence', () => {
    expect(run({ immutable: manifest('sha256:' + 'b'.repeat(64)) }).stderr).toContain(
      'REGISTRY_IMMUTABLE_DIGEST_MISMATCH',
    );
    for (const tag of [
      '',
      '{}',
      '{broken',
      manifest('latest'),
      manifest(digest + '\n'),
      manifest() + '\n{}',
      manifest() + '\n' + manifest(),
      JSON.stringify({ schemaVersion: 2, config: { digest } }),
    ]) {
      const result = run({ tag });
      expect(result.status).not.toBe(0);
      expect(result.calls).toHaveLength(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('REGISTRY_MANIFEST_DIGEST_INVALID\n');
    }
  });

  it('refuses unrelated registries, repositories, references and option injection before credentials are used', () => {
    for (const ref of [
      'docker.io/library/node:24',
      prefix.replace('toca-mcp-production', 'other-project') + 'ag01:tag',
      prefix + 'other-service:tag',
      prefix + 'ag01',
      prefix + 'ag01@sha256:bad',
      '--help',
      prefix + 'ag01:tag\n--insecure',
      prefix + 'ag01:tag/extra',
      prefix.replace('docker.pkg.dev', 'dockerXpkgXdev') + 'ag01:tag',
    ]) {
      const result = run({ ref });
      expect(result.status, ref).not.toBe(0);
      expect(result.calls).toEqual([]);
    }
  });

  it('applies the same resolver to AG01 and each canonical Marketing image without replacing security gates', () => {
    const files = [
      '.github/workflows/ag01-grounded-runtime-activation.yml',
      '.github/workflows/marketing-publish-now.yml',
      'scripts/marketing-publish-now.sh',
      'scripts/marketing-publish-now-fixed.sh',
    ];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text).toContain('scripts/resolve-artifact-registry-digest.sh');
      expect(text).not.toContain('gcloud artifacts docker images describe');
    }
    const resolver = readFileSync(script, 'utf8');
    expect(resolver).toContain('timeout --kill-after=5s 30s');
    expect(resolver).not.toContain('gcloud');
    const security = readFileSync('.github/workflows/security-supply-chain.yml', 'utf8');
    expect(security).toContain('Scan AG-01 orchestrator candidate');
    expect(security).toContain('toca-ag01-sbom.cdx.json');
  });
});
