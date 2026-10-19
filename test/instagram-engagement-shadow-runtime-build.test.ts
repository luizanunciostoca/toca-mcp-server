import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-runtime-build.yml',
  'utf8',
);
const directories = new Set<string>();
const sourceSha = '1'.repeat(40);
const imageDigest = 'sha256:' + '2'.repeat(64);

afterEach(() => {
  for (const path of directories) rmSync(path, { recursive: true, force: true });
  directories.clear();
});

function stepScript(name: string): string {
  const section = workflow.split('      - name: ' + name + '\n')[1]?.split('\n      - name:')[0];
  const body = section?.split('        run: |\n')[1];
  if (!body) throw new Error('Workflow step was not found: ' + name);
  return body
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
}

function buildAuthorization() {
  return {
    number: 123,
    state: 'open',
    user: { login: 'luizanunciostoca' },
    title: 'PRODUCTION AUTHORIZATION — Instagram engagement shadow runtime build AUTO test',
    body: [
      'AUTHORIZED_CANDIDATE_SHA=' + sourceSha,
      'AUTHORIZATION_STATE=ACTIVE',
      'INSTAGRAM_ENGAGEMENT_SHADOW_RUNTIME_BUILD=AUTHORIZED',
      'AUTO_BUILD_AUTHORIZED=true',
      'RUNTIME_BUILD_ONLY=true',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'SERVICE_DEPLOY_AUTHORIZED=false',
      'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
    ].join('\n'),
    privateTestValue: 'PRIVATE_AUTHORIZATION_MUST_STAY_PRIVATE',
  };
}

function buildHarness(issue = buildAuthorization()) {
  const root = mkdtempSync(join(tmpdir(), 'shadow-build-authorization-test-'));
  directories.add(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'issue.json'), JSON.stringify(issue));
  writeFileSync(join(root, 'main-sha'), sourceSha);
  writeFileSync(join(root, 'event.json'), JSON.stringify({ issue: buildAuthorization() }));
  writeFileSync(join(root, 'environment'), '');
  writeFileSync(join(root, 'output'), '');
  writeFileSync(
    join(root, 'scripts/resolve-artifact-registry-digest.sh'),
    "printf '%s\\n' '" + imageDigest + "'\n",
  );
  const executable = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(path, '#!' + process.execPath + '\n' + body);
    chmodSync(path, 0o700);
  };
  executable('git', "process.stdout.write(process.env.GITHUB_SHA + '\\n');");
  executable(
    'gh',
    String.raw`
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const root = process.env.MOCK_ROOT;
fs.appendFileSync(path.join(root, 'github-calls'), JSON.stringify(args) + '\n');
if (args[0] !== 'api') process.exit(64);
if (args[1] === 'repos/luizanunciostoca/toca-mcp-server/issues/123') {
  process.stdout.write(fs.readFileSync(path.join(root, 'issue.json')));
} else if (args[1] === 'repos/luizanunciostoca/toca-mcp-server/branches/main') {
  process.stdout.write(fs.readFileSync(path.join(root, 'main-sha')));
} else process.exit(65);
`,
  );
  executable(
    'docker',
    String.raw`
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const root = process.env.MOCK_ROOT;
fs.appendFileSync(path.join(root, 'docker-calls'), JSON.stringify(args) + '\n');
if (!['build', 'push'].includes(args[0])) process.exit(64);
if (args[0] === 'build' && process.env.REVOKE_AFTER_BUILD) {
  const issue = JSON.parse(fs.readFileSync(path.join(root, 'issue.json')));
  if (process.env.REVOKE_AFTER_BUILD === 'closed') issue.state = 'closed';
  if (process.env.REVOKE_AFTER_BUILD === 'scope') issue.body = issue.body.replace('AUTO_BUILD_AUTHORIZED=true', 'AUTO_BUILD_AUTHORIZED=false');
  if (process.env.REVOKE_AFTER_BUILD === 'main') fs.writeFileSync(path.join(root, 'main-sha'), '3'.repeat(40));
  fs.writeFileSync(path.join(root, 'issue.json'), JSON.stringify(issue));
}
`,
  );
  const calls = (name: string): string[][] =>
    existsSync(join(root, name))
      ? readFileSync(join(root, name), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as string[])
      : [];
  const run = (name: string, env: Record<string, string> = {}) => {
    const script = join(root, 'step.sh');
    writeFileSync(script, stepScript(name));
    const stdout = openSync(join(root, 'stdout'), 'w');
    const stderr = openSync(join(root, 'stderr'), 'w');
    try {
      const result = spawnSync('bash', [script], {
        cwd: root,
        timeout: 10_000,
        stdio: ['ignore', stdout, stderr],
        env: {
          ...process.env,
          PATH: bin + ':' + process.env.PATH,
          MOCK_ROOT: root,
          GH_TOKEN: 'FAKE_TOKEN_MUST_STAY_PRIVATE',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_SHA: sourceSha,
          GITHUB_REPOSITORY: 'luizanunciostoca/toca-mcp-server',
          GITHUB_REPOSITORY_OWNER: 'luizanunciostoca',
          GITHUB_RUN_ATTEMPT: '1',
          GITHUB_EVENT_PATH: join(root, 'event.json'),
          GITHUB_ENV: join(root, 'environment'),
          GITHUB_OUTPUT: join(root, 'output'),
          AUTHORIZATION_ISSUE_NUMBER: '123',
          GCP_PROJECT_ID: 'toca-mcp-production',
          GCP_REGION: 'southamerica-east1',
          GCP_ARTIFACT_REPOSITORY: 'toca-mcp',
          CANDIDATE_SOURCE_SHA: 'NONE',
          CANDIDATE_DIGEST: 'NONE',
          ...env,
        },
      });
      if (result.error) throw result.error;
      return {
        status: result.status,
        stdout: readFileSync(join(root, 'stdout'), 'utf8'),
        stderr: readFileSync(join(root, 'stderr'), 'utf8'),
      };
    } finally {
      closeSync(stdout);
      closeSync(stderr);
    }
  };
  return {
    root,
    run,
    dockerCalls: () => calls('docker-calls'),
    githubCalls: () => calls('github-calls'),
  };
}

describe('Instagram engagement shadow runtime build-only workflow', () => {
  it('requires an owner-authored exact-main authorization issue', () => {
    expect(workflow).toContain('issues:');
    expect(workflow).toContain('types: [opened]');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('github.event.issue.user.login == github.repository_owner');
    expect(workflow).toContain('test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('AUTHORIZED_CANDIDATE_SHA=$GITHUB_SHA');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_SHADOW_RUNTIME_BUILD=AUTHORIZED');
  });

  it('requires explicit build-only boundaries and keeps side effects disabled', () => {
    for (const boundary of [
      'AUTO_BUILD_AUTHORIZED=true',
      'RUNTIME_BUILD_ONLY=true',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'SERVICE_DEPLOY_AUTHORIZED=false',
      'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
    ]) {
      expect(workflow).toContain(boundary);
    }

    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(workflow).not.toContain('migrate-and-verify');
    expect(workflow).not.toContain('gcloud run ');
    expect(workflow).not.toContain('gcloud scheduler ');
  });

  it('only publishes an immutable Artifact Registry runtime and sanitized evidence', () => {
    expect(workflow).toContain('docker build --pull -t "$IMAGE_TAG" .');
    expect(workflow).toContain('docker push "$IMAGE_TAG"');
    for (const image of ['CANDIDATE_IMAGE', 'IMAGE_TAG', 'IMMUTABLE_IMAGE']) {
      expect(workflow).toContain(
        'bash scripts/resolve-artifact-registry-digest.sh "$' + image + '"',
      );
    }
    expect(workflow).toContain('^sha256:[0-9a-f]{64}$');
    expect(workflow).toContain('SHADOW_RUNTIME_BUILD_STATUS=PASS');
    expect(workflow).toContain('BUILD_ONLY=true');
    expect(workflow).toContain('DATABASE_MUTATIONS=false');
    expect(workflow).toContain('SERVICE_DEPLOY=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES=false');
  });

  it('always consumes and closes the single-use authorization after validation', () => {
    for (const marker of [
      'Consume single-use build authorization',
      "if: always() && env.AUTHORIZATION_ISSUE_NUMBER != ''",
      'AUTHORIZATION_STATE=CONSUMED_AND_CLOSED',
      'AUTO_BUILD_AUTHORIZED=false',
      's/^AUTHORIZATION_STATE=ACTIVE$/AUTHORIZATION_STATE=CONSUMED_AND_CLOSED/',
      's/^AUTO_BUILD_AUTHORIZED=true$/AUTO_BUILD_AUTHORIZED=false/',
      '-f state=closed',
      '-f state_reason=completed',
      'SHADOW_RUNTIME_BUILD_AUTHORIZATION_CONSUMED=true',
    ]) {
      expect(workflow).toContain(marker);
    }
  });
});

describe('actual shadow build authorization boundaries with isolated commands', () => {
  const initial = 'Validate owner authorization and exact main SHA';
  const image = 'Reuse or build immutable shadow runtime';

  it('uses the LIVE issue even when the frozen opened event was authorized', () => {
    const issue = buildAuthorization();
    issue.state = 'closed';
    const harness = buildHarness(issue);
    const result = harness.run(initial);
    expect(result.status).toBe(1);
    expect(harness.githubCalls()).toHaveLength(1);
    expect(readFileSync(join(harness.root, 'environment'), 'utf8')).toBe('');
    expect(harness.dockerCalls()).toEqual([]);
  });

  it.each([initial, image])('rejects rerun attempt 2 before build or reuse in %s', (step) => {
    const harness = buildHarness();
    const result = harness.run(step, { GITHUB_RUN_ATTEMPT: '2' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SHADOW_BUILD_NEW_AUTHORIZATION_REQUIRED_FOR_RERUN');
    expect(harness.githubCalls()).toEqual([]);
    expect(harness.dockerCalls()).toEqual([]);
  });

  it.each([
    'closed',
    'consumed',
    'owner',
    'number',
    'title',
    'source',
    'main',
    'contradictory-scope',
  ])('blocks a changed LIVE %s authorization before build or push', (change) => {
    const issue = buildAuthorization();
    if (change === 'closed') issue.state = 'closed';
    if (change === 'consumed')
      issue.body = issue.body.replace(
        'AUTHORIZATION_STATE=ACTIVE',
        'AUTHORIZATION_STATE=CONSUMED_AND_CLOSED',
      );
    if (change === 'owner') issue.user.login = 'another-owner';
    if (change === 'number') issue.number = 124;
    if (change === 'title') issue.title = 'Unrelated issue';
    if (change === 'source') issue.body = issue.body.replace(sourceSha, '3'.repeat(40));
    if (change === 'contradictory-scope') issue.body += '\nSERVICE_DEPLOY_AUTHORIZED=true';
    const harness = buildHarness(issue);
    if (change === 'main') writeFileSync(join(harness.root, 'main-sha'), '3'.repeat(40));
    const result = harness.run(image);
    expect(result.status).toBe(1);
    expect(harness.dockerCalls()).toEqual([]);
    expect(readFileSync(join(harness.root, 'output'), 'utf8')).toBe('');
    expect(result.stdout + result.stderr).not.toMatch(/PRIVATE_AUTHORIZATION|FAKE_TOKEN/);
  });

  it.each(['closed', 'scope', 'main'])(
    'blocks push when authorization or source is revoked during build: %s',
    (change) => {
      const harness = buildHarness();
      const result = harness.run(image, { REVOKE_AFTER_BUILD: change });
      expect(result.status).toBe(1);
      expect(harness.dockerCalls().map((args) => args[0])).toEqual(['build']);
      expect(readFileSync(join(harness.root, 'output'), 'utf8')).toBe('');
      expect(result.stdout + result.stderr).not.toMatch(/PRIVATE_AUTHORIZATION|FAKE_TOKEN/);
    },
  );

  it('builds and pushes once with the same live first-attempt authorization', () => {
    const harness = buildHarness();
    const authorization = harness.run(initial);
    expect(authorization.status, authorization.stderr).toBe(0);
    expect(readFileSync(join(harness.root, 'environment'), 'utf8')).toContain(
      'AUTHORIZATION_ISSUE_NUMBER=123',
    );
    const result = harness.run(image);
    expect(result.status, result.stderr).toBe(0);
    expect(harness.dockerCalls().map((args) => args[0])).toEqual(['build', 'push']);
    expect(readFileSync(join(harness.root, 'output'), 'utf8')).toContain(
      'runtime_image_digest=' + imageDigest,
    );
  });
});
