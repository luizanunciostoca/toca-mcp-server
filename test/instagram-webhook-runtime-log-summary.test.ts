import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { evaluateReadiness } from '../src/health/readiness.js';

const script = 'scripts/instagram-webhook-runtime-log-summary.mjs';
const revision = 'toca-webhook-next-production-w9434008a1';
const since = '2026-10-18T20:00:00Z';
const until = '2026-10-18T22:00:00Z';
const entry = (extra: Record<string, unknown> = {}) => ({
  resource: {
    type: 'cloud_run_revision',
    labels: {
      project_id: 'toca-mcp-production',
      location: 'southamerica-east1',
      service_name: 'toca-webhook-next-production',
      revision_name: revision,
    },
  },
  timestamp: '2026-10-18T21:00:00Z',
  ...extra,
});

function run(input: unknown, args = [revision, since, until], raw = false) {
  const dir = mkdtempSync(join(tmpdir(), 'webhook-log-summary-'));
  try {
    const file = join(dir, 'logs.json');
    writeFileSync(file, raw ? String(input) : JSON.stringify(input));
    const result = spawnSync(process.execPath, [script, file, ...args], { encoding: 'utf8' });
    if (result.error) throw result.error;
    return {
      ...result,
      output: result.status === 0 ? (JSON.parse(result.stdout) as Record<string, unknown>) : {},
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('bounded webhook runtime log diagnostics', () => {
  it('reports allowlisted error signals and status counts without publishing private input', () => {
    const result = run([
      entry({
        textPayload:
          'HTTP request failed READINESS_SCHEMA_MISSING relation private_guests does not exist token=SECRET-CUSTOMER',
      }),
      entry({
        httpRequest: {
          status: 500,
          requestUrl: 'https://private.invalid/?token=PRIVATE-TOKEN',
          remoteIp: '192.0.2.10',
        },
      }),
      entry({
        jsonPayload: { message: 'connect ECONNREFUSED db-password', customer: 'PRIVATE-GUEST' },
      }),
    ]);
    expect(result.status).toBe(0);
    expect(result.output).toMatchObject({
      classification: 'RUNTIME_ERROR_SIGNALS_OBSERVED',
      matchedEntries: 3,
      httpStatusCounts: { 500: 1 },
      approvedErrorTokens: ['READINESS_SCHEMA_MISSING'],
      errorSignals: ['DEPENDENCY_CONNECTIVITY', 'HTTP_HANDLER', 'PERSISTENCE_SCHEMA'],
      rootCause: 'NOT_PROVEN_BY_LOG_CLASSIFICATION',
      runtimeHealth: 'NOT_PROVEN_BY_LOG_CLASSIFICATION',
      rawLogPayloadPublished: false,
    });
    for (const secret of [
      'private_guests',
      'SECRET-CUSTOMER',
      'PRIVATE-TOKEN',
      'PRIVATE-GUEST',
      'db-password',
      '192.0.2.10',
    ]) {
      expect(result.stdout + result.stderr).not.toContain(secret);
    }
  });

  it('recognizes the actual readiness failure log without publishing failure details', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const report = await evaluateReadiness([
        {
          name: 'schema',
          check: () =>
            Promise.reject(
              new Error('READINESS_SCHEMA_MISSING:private_guests token=PRIVATE-TOKEN'),
            ),
        },
      ]);
      expect(report.status).toBe('not_ready');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('TOCA_READINESS_NOT_READY failed_checks=schema');
      const message: unknown = warn.mock.calls[0]?.[0];
      const result = run([entry({ textPayload: message })]);
      expect(result.status).toBe(0);
      expect(result.output).toMatchObject({
        classification: 'RUNTIME_ERROR_SIGNALS_OBSERVED',
        matchedEntries: 1,
        httpStatusCounts: {},
        approvedErrorTokens: ['TOCA_READINESS_NOT_READY'],
        errorSignals: [],
        rootCause: 'NOT_PROVEN_BY_LOG_CLASSIFICATION',
        runtimeHealth: 'NOT_PROVEN_BY_LOG_CLASSIFICATION',
        rawLogPayloadPublished: false,
      });
      for (const detail of [
        'failed_checks=',
        'READINESS_SCHEMA_MISSING',
        'private_guests',
        'PRIVATE-TOKEN',
      ]) {
        expect(result.stdout + result.stderr).not.toContain(detail);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it.each(['ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'])(
    'recognizes explicit %s severity without publishing its private message',
    (severity) => {
      const result = run([
        entry({ severity, textPayload: 'TypeError: PRIVATE-DETAIL token=PRIVATE-TOKEN' }),
      ]);
      expect(result.status).toBe(0);
      expect(result.output).toMatchObject({
        classification: 'RUNTIME_ERROR_SIGNALS_OBSERVED',
        matchedEntries: 1,
        httpStatusCounts: {},
        approvedErrorTokens: [],
        errorSignals: ['ERROR_SEVERITY'],
        rootCause: 'NOT_PROVEN_BY_LOG_CLASSIFICATION',
        runtimeHealth: 'NOT_PROVEN_BY_LOG_CLASSIFICATION',
        rawLogPayloadPublished: false,
      });
      for (const detail of ['TypeError', 'PRIVATE-DETAIL', 'PRIVATE-TOKEN']) {
        expect(result.stdout + result.stderr).not.toContain(detail);
      }
    },
  );

  it('does not treat lower or malformed severities as an explicit error signal', () => {
    const result = run(
      ['DEFAULT', 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR PRIVATE-TOKEN', null, 500].map(
        (severity) => entry({ severity }),
      ),
    );
    expect(result.status).toBe(0);
    expect(result.output).toMatchObject({
      classification: 'NO_ERROR_SIGNAL_IN_BOUNDED_SAMPLE',
      approvedErrorTokens: [],
      errorSignals: [],
    });
    expect(result.stdout + result.stderr).not.toContain('PRIVATE-TOKEN');
  });

  it('excludes stale, future and foreign service, project, region and revision evidence', () => {
    const good = entry();
    const foreign = Object.entries(good.resource.labels).map(([key]) => ({
      ...good,
      resource: { ...good.resource, labels: { ...good.resource.labels, [key]: 'other' } },
      textPayload: 'ERR_MODULE_NOT_FOUND',
    }));
    const result = run(
      [
        ...foreign,
        entry({ timestamp: '2026-10-17T21:00:00Z' }),
        entry({ timestamp: '2026-10-19T21:00:00Z' }),
        entry({ timestamp: 'invalid' }),
        entry({ resource: { type: 'cloud_run_job' } }),
      ].map((log) => ({
        ...log,
        severity: 'ERROR',
        textPayload: 'TOCA_READINESS_NOT_READY ERR_MODULE_NOT_FOUND',
      })),
    );
    expect(result.output).toMatchObject({
      classification: 'INSUFFICIENT_CURRENT_LOG_EVIDENCE',
      matchedEntries: 0,
      excludedEntries: 8,
      approvedErrorTokens: [],
      errorSignals: [],
    });
  });

  it('does not certify health from empty logs or a sample without errors', () => {
    expect(run([]).output.classification).toBe('INSUFFICIENT_CURRENT_LOG_EVIDENCE');
    const result = run([entry({ httpRequest: { status: 200 } })]);
    expect(result.output).toMatchObject({
      classification: 'NO_ERROR_SIGNAL_IN_BOUNDED_SAMPLE',
      runtimeHealth: 'NOT_PROVEN_BY_LOG_CLASSIFICATION',
    });
  });

  it('rejects invalid windows, targets, oversized arrays and malformed input with fixed diagnostics', () => {
    for (const args of [
      [revision, since, '2026-10-19T22:00:00Z'],
      [revision, until, since],
      ['other-service-1', since, until],
      [revision, 'invalid', until],
    ]) {
      expect(run([], args).status).toBe(1);
    }
    expect(run(Array.from({ length: 201 }, () => entry())).status).toBe(1);
    expect(run({ secret: 'private' }).status).toBe(1);
    const malformed = run('{ "private-secret": BROKEN', undefined, true);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toBe('WEBHOOK_DIAGNOSTIC_INPUT_REJECTED\n');
  });

  it('marks a full bounded sample and does not coerce missing HTTP status to a measurement', () => {
    const result = run(Array.from({ length: 200 }, () => entry({ httpRequest: { status: null } })));
    expect(result.output).toMatchObject({ sampleLimitReached: true, httpStatusCounts: {} });
  });

  it('restricts public probes to a canonical HTTPS service URL without credentials or redirects', () => {
    const code = `import { validateWebhookServiceUrl } from './${script}';
      try { console.log(validateWebhookServiceUrl(process.argv[1])); } catch { process.exitCode = 1; }`;
    const check = (url: string) =>
      spawnSync(process.execPath, ['--input-type=module', '-e', code, url], { encoding: 'utf8' });
    expect(
      check('https://toca-webhook-next-production-990081828836.southamerica-east1.run.app').status,
    ).toBe(0);
    expect(check('https://toca-webhook-next-production-abcd-uc.a.run.app/').status).toBe(0);
    for (const bad of [
      'http://toca-webhook-next-production-a.run.app',
      'https://other-a.run.app',
      'https://toca-webhook-next-production-a.run.app.evil.invalid',
      'https://user:pass@toca-webhook-next-production-a.run.app',
      'https://toca-webhook-next-production-a.run.app/?token=secret',
      'https://toca-webhook-next-production-a.run.app/webhooks/meta',
      'https://toca-webhook-next-production-a.run.app/#secret',
    ]) {
      expect(check(bad).status, bad).toBe(1);
    }
  });
});
