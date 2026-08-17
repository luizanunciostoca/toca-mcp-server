import { mkdirSync, writeFileSync } from 'node:fs';
import { assertCiRuntime, captureCommand, pnpmCommand, runCommand } from './ci-helpers.mjs';
import { runQualityGates } from './quality-gates.mjs';

const timestamp = new Date().toISOString().replaceAll(':', '-');
const evidenceDir =
  process.env.TOCA_VERIFICATION_EVIDENCE_DIR ?? `.artifacts/local-verification/${timestamp}`;
const commitShaPattern = /^[0-9a-f]{40}$/i;
mkdirSync(evidenceDir, { recursive: true });

const summary = {
  schemaVersion: 1,
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  sourceSha: 'unresolved',
  sourceTree: 'unverified',
  node: process.versions.node,
  pnpm: 'unknown',
  postgres: '18',
  gates: [],
};

function persistSummary() {
  writeFileSync(`${evidenceDir}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function verifySourceTree() {
  let gitSha;
  let gitStatus;
  const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  try {
    gitSha = captureCommand('git', ['rev-parse', 'HEAD'], { env: gitEnv });
    gitStatus = captureCommand('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      env: gitEnv,
    });
  } catch (error) {
    throw new Error(
      `SOURCE_GIT_CHECK_FAILED ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!commitShaPattern.test(gitSha)) throw new Error(`SOURCE_SHA_INVALID=${gitSha}`);
  if (gitStatus) throw new Error(`SOURCE_TREE_DIRTY=${JSON.stringify(gitStatus.split('\n'))}`);

  const expectedSha = process.env.TOCA_SOURCE_SHA ?? process.env.GITHUB_SHA;
  if (expectedSha) {
    if (!commitShaPattern.test(expectedSha)) {
      throw new Error(`SOURCE_SHA_INVALID=${expectedSha}`);
    }
    if (expectedSha.toLowerCase() !== gitSha.toLowerCase()) {
      throw new Error(`SOURCE_SHA_MISMATCH expected=${expectedSha} actual=${gitSha}`);
    }
  }

  return gitSha.toLowerCase();
}

try {
  const runtime = assertCiRuntime();
  summary.node = runtime.node;
  summary.pnpm = runtime.pnpm;
  summary.sourceSha = verifySourceTree();
  summary.sourceTree = 'clean';
  persistSummary();

  runCommand(pnpmCommand(), ['install', '--frozen-lockfile'], {
    name: 'INSTALL_FROZEN_LOCKFILE',
    logPath: `${evidenceDir}/install.log`,
  });
  summary.gates.push('INSTALL_FROZEN_LOCKFILE');

  runCommand(pnpmCommand(), ['workflow:supply-chain'], {
    name: 'WORKFLOW_SUPPLY_CHAIN',
    logPath: `${evidenceDir}/workflow-supply-chain.log`,
  });
  summary.gates.push('WORKFLOW_SUPPLY_CHAIN');

  const quality = runQualityGates({ evidenceDir });
  summary.gates.push(...quality.records.map((record) => record.name));

  runCommand(pnpmCommand(), ['postgres:e2e'], {
    name: 'POSTGRES_E2E',
    env: {
      ...process.env,
      TOCA_POSTGRES_E2E_EVIDENCE_DIR: `${evidenceDir}/postgres-e2e`,
    },
    logPath: `${evidenceDir}/postgres-e2e.log`,
  });
  summary.gates.push('POSTGRES_E2E');

  summary.status = 'LOCAL_VERIFIED';
  summary.finishedAt = new Date().toISOString();
  persistSummary();
  console.log(`TOCA_VERIFICATION_SOURCE_SHA=${summary.sourceSha}`);
  console.log('TOCA_VERIFICATION_SOURCE_TREE=CLEAN');
  console.log(`TOCA_VERIFICATION_EVIDENCE_DIR=${evidenceDir}`);
  console.log('TOCA_VERIFICATION_STATUS=LOCAL_VERIFIED');
} catch (error) {
  summary.status = 'FAILED';
  summary.finishedAt = new Date().toISOString();
  summary.failure = error instanceof Error ? error.message : String(error);
  persistSummary();
  console.error(`TOCA_VERIFICATION_EVIDENCE_DIR=${evidenceDir}`);
  console.error(`TOCA_VERIFICATION_STATUS=FAILED ${summary.failure}`);
  process.exit(1);
}
