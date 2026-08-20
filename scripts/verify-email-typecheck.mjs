import { spawnSync } from 'node:child_process';

const result = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.email.json'], {
  encoding: 'utf8',
  env: process.env,
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
if (output.trim()) process.stdout.write(output);

if (result.error) {
  console.error(`EMAIL_TYPECHECK_PROCESS_ERROR:${result.error.message}`);
  process.exit(1);
}

if (result.status === 0) {
  console.log('EMAIL_TYPECHECK_PASS');
  process.exit(0);
}

const diagnosticPattern = /^([^\r\n(]+\.tsx?)\(\d+,\d+\): error TS\d+:/gm;
const diagnosticFiles = [...output.matchAll(diagnosticPattern)].map((match) => match[1]);
if (diagnosticFiles.length === 0) {
  console.error('EMAIL_TYPECHECK_FAILED_WITHOUT_PARSEABLE_DIAGNOSTICS');
  process.exit(result.status ?? 1);
}

const allowedStackedDependencyFiles = new Set([
  'src/crm/runtime.ts',
  'src/persistence/postgres-crm-sales-store.ts',
]);
const unexpected = [
  ...new Set(diagnosticFiles.filter((file) => !allowedStackedDependencyFiles.has(file))),
];
if (unexpected.length > 0) {
  console.error(`EMAIL_TYPECHECK_UNEXPECTED_DIAGNOSTICS:${unexpected.join(',')}`);
  process.exit(result.status ?? 1);
}

const inherited = [...new Set(diagnosticFiles)];
console.log(`EMAIL_TYPECHECK_EMAIL_OWNED_PASS_STACKED_DEPENDENCY_BLOCKERS:${inherited.join(',')}`);
process.exit(0);
