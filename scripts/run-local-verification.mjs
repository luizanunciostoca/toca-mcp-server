import { mkdirSync, writeFileSync } from 'node:fs';
import { assertCiRuntime, captureCommand, pnpmCommand, runCommand } from './ci-helpers.mjs';
import { runQualityGates } from './quality-gates.mjs';

const timestamp = new Date().toISOString().replaceAll(':', '-');
const evidenceDir =
  process.env.TOCA_VERIFICATION_EVIDENCE_DIR ?? `.artifacts/local-verification/${timestamp}`;
mkdirSync(evidenceDir, { recursive: true });

const summary = {
  schemaVersion: 1,
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  sourceSha: 'unknown',
  node: process.versions.node,
  pnpm: 'unknown',
  postgres: '18',
  gates: [],
};

function persistSummary() {
  writeFileSync(`${evidenceDir}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

try {
  const runtime = assertCiRuntime();
  summary.node = runtime.node;
  summary.pnpm = runtime.pnpm;
  try {
    summary.sourceSha = captureCommand('git', ['rev-parse', 'HEAD']);
  } catch {
    summary.sourceSha = process.env.GITHUB_SHA ?? 'unknown';
  }
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
    logPath: `${evidenceDir}/postgres-e2e.log`,
  });
  summary.gates.push('POSTGRES_E2E');

  summary.status = 'LOCAL_VERIFIED';
  summary.finishedAt = new Date().toISOString();
  persistSummary();
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
