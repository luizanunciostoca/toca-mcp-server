import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const EXPECTED_NODE_MAJOR = 24;
export const EXPECTED_PNPM_VERSION = '10.15.0';

export function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

export function dockerCommand() {
  return process.platform === 'win32' ? 'docker.exe' : 'docker';
}

export function runCommand(command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const finishedAt = new Date().toISOString();
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  if (options.echo !== false) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }

  const record = {
    name: options.name ?? `${command} ${args.join(' ')}`,
    command: [command, ...args],
    startedAt,
    finishedAt,
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    stdout,
    stderr,
  };

  if (options.logPath) {
    mkdirSync(dirname(options.logPath), { recursive: true });
    writeFileSync(
      options.logPath,
      [
        `# ${record.name}`,
        `started_at=${startedAt}`,
        `finished_at=${finishedAt}`,
        `exit_code=${record.exitCode}`,
        '',
        '## stdout',
        stdout,
        '',
        '## stderr',
        stderr,
      ].join('\n'),
      'utf8',
    );
  }

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${record.name} failed with exit code ${record.exitCode}`);
    error.record = record;
    throw error;
  }

  return record;
}

export function captureCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${(result.stderr ?? '').trim() || result.status}`,
    );
  }
  return (result.stdout ?? '').trim();
}

export function assertCiRuntime() {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  if (nodeMajor !== EXPECTED_NODE_MAJOR) {
    throw new Error(
      `CI_NODE_VERSION_MISMATCH expected=${EXPECTED_NODE_MAJOR}.x actual=${process.versions.node}`,
    );
  }

  const pnpmVersion = captureCommand(pnpmCommand(), ['--version']);
  if (pnpmVersion !== EXPECTED_PNPM_VERSION) {
    throw new Error(
      `CI_PNPM_VERSION_MISMATCH expected=${EXPECTED_PNPM_VERSION} actual=${pnpmVersion}`,
    );
  }

  return {
    node: process.versions.node,
    pnpm: pnpmVersion,
  };
}
