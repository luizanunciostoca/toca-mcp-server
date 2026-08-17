import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCiRuntime, pnpmCommand, runCommand } from './ci-helpers.mjs';

export const qualityGates = [
  ['FORMAT', ['format:check']],
  ['ARCHITECTURE', ['architecture:check']],
  ['LINT', ['lint']],
  ['TYPECHECK', ['typecheck']],
  ['TEST', ['test']],
  ['BUILD', ['build']],
];

export function runQualityGates(options = {}) {
  const runtime = assertCiRuntime();
  const records = [];

  for (const [name, args] of qualityGates) {
    console.log(`QUALITY_GATE_START=${name}`);
    const logPath = options.evidenceDir
      ? `${options.evidenceDir}/${name.toLowerCase()}.log`
      : undefined;
    const record = runCommand(pnpmCommand(), args, {
      name,
      logPath,
    });
    records.push(record);
    console.log(`QUALITY_GATE_PASS=${name}`);
  }

  console.log('QUALITY_GATE_RESULT=PASS');
  return { runtime, records };
}

const isDirectExecution = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isDirectExecution) {
  try {
    runQualityGates();
  } catch (error) {
    console.error(`QUALITY_GATE_RESULT=FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
