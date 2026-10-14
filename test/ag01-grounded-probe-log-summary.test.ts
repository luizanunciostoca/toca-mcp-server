import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = 'scripts/ag01-grounded-probe-log-summary.mjs';
const candidate = 'https://private-tag---toca-ag01-orchestrator.a.run.app';
const http = (method: string, path: string, status: number) => ({
  httpRequest: { requestMethod: method, requestUrl: candidate + path, status },
});
const event = (status: string, citedResourceCount: number, secret = 'private-guest-message') => ({
  textPayload: JSON.stringify({
    event: 'ag01.grounded_knowledge.completed',
    status,
    citedResourceCount,
    customerMessage: secret,
    citedResourceIds: ['private-drive-resource'],
    answer: 'confidential answer',
  }),
});

function runLogs(entries: unknown): {
  exit: number | null;
  output: Record<string, unknown>;
  stdout: string;
  stderr: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'ag01-sanitized-probe-'));
  const fixture = join(dir, 'private-cloud-run-logs.json');
  writeFileSync(fixture, JSON.stringify(entries), 'utf8');
  const result = spawnSync(process.execPath, [script, fixture], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return {
    exit: result.status,
    output: result.status === 0 ? (JSON.parse(result.stdout) as Record<string, unknown>) : {},
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('AG-01 sanitized private probe log classifier', () => {
  it('identifies an HTTP-200 grounding response that returned no verified answer', () => {
    const result = runLogs([
      http('POST', '/v1/knowledge/answer', 200),
      event('NO_GROUNDED_ANSWER', 0),
      http('GET', '/ready', 200),
      http('GET', '/health', 200),
    ]);
    expect(result.exit, result.stderr).toBe(0);
    expect(result.output).toMatchObject({
      schemaVersion: 1,
      classification: 'GROUNDED_KNOWLEDGE_NO_VERIFIED_ANSWER',
      healthHttpStatus: '200',
      readyHttpStatus: '200',
      groundingHttpStatus: '200',
      groundingResult: 'NO_GROUNDED_ANSWER',
      citedResourceCount: 0,
      rawLogPayloadPublished: false,
    });
  });

  it('differentiates a verified grounding event with citations from a full semantic proof', () => {
    const result = runLogs([
      {
        jsonPayload: {
          event: 'ag01.grounded_knowledge.completed',
          status: 'GROUNDED',
          citedResourceCount: 2,
        },
      },
      http('POST', '/v1/knowledge/answer', 200),
    ]);
    expect(result.exit).toBe(0);
    expect(result.output).toMatchObject({
      classification: 'APPLICATION_GROUNDING_EVENT_PASS_OTHER_PROBE_ASSERTION_UNPROVEN',
      groundingResult: 'GROUNDED',
      citedResourceCount: 2,
    });
  });

  it('classifies missing citations without disclosing source IDs', () => {
    const result = runLogs([event('GROUNDED', 0)]);
    expect(result.output).toMatchObject({
      classification: 'GROUNDED_KNOWLEDGE_MISSING_CITATIONS',
      citedResourceCount: 0,
    });
    expect(result.stdout).not.toContain('private-drive-resource');
  });

  it('prioritizes a private health authentication failure', () => {
    const result = runLogs([
      http('GET', '/health', 403),
      http('GET', '/ready', 200),
      event('NO_GROUNDED_ANSWER', 0),
    ]);
    expect(result.output).toMatchObject({
      classification: 'PRIVATE_HEALTH_HTTP_NON200',
      healthHttpStatus: '403',
    });
  });

  it('separates readiness failures and model endpoint HTTP failures', () => {
    const ready = runLogs([http('GET', '/health', 200), http('GET', '/ready', 503)]);
    const grounding = runLogs([
      http('GET', '/health', 200),
      http('GET', '/ready', 200),
      http('POST', '/v1/knowledge/answer', 504),
    ]);
    expect(ready.output).toMatchObject({ classification: 'PRIVATE_READY_HTTP_NON200' });
    expect(grounding.output).toMatchObject({
      classification: 'PRIVATE_GROUNDING_HTTP_NON200',
      groundingHttpStatus: '504',
    });
  });

  it('returns insufficient evidence rather than making up successful provider proof', () => {
    const result = runLogs([]);
    expect(result.output).toMatchObject({
      classification: 'INSUFFICIENT_LOG_PROOF',
      groundingResult: 'NOT_OBSERVED',
      healthHttpStatus: 'NOT_OBSERVED',
      readyHttpStatus: 'NOT_OBSERVED',
      groundingHttpStatus: 'NOT_OBSERVED',
    });
  });

  it('uses the most recent request and event from descending logs', () => {
    const result = runLogs([
      http('GET', '/health', 200),
      event('NO_GROUNDED_ANSWER', 0),
      http('GET', '/health', 403),
      event('GROUNDED', 4),
    ]);
    expect(result.output).toMatchObject({
      healthHttpStatus: '200',
      groundingResult: 'NO_GROUNDED_ANSWER',
      groundedEventCount: 2,
    });
  });

  it('redacts private strings, unsanitized error values, URL query parameters and tokens', () => {
    const sensitive = 'private-customer-PHONE-5511111111';
    const result = runLogs([
      {
        httpRequest: {
          requestMethod: 'GET',
          requestUrl: candidate + '/health?api_key=' + sensitive,
          status: 200,
        },
      },
      { jsonPayload: { event: 'ag01.http.failed', errorCode: sensitive, rawRequest: sensitive } },
      event('NO_GROUNDED_ANSWER', 0, sensitive),
    ]);
    expect(result.exit).toBe(0);
    expect(result.output).toMatchObject({
      healthHttpStatus: '200',
      appErrorCategory: 'REDACTED_OTHER_APP_ERROR',
      rawLogPayloadPublished: false,
    });
    expect(result.stdout).not.toContain(sensitive);
    expect(result.stdout).not.toContain('customerMessage');
    expect(result.stdout).not.toContain('answer');
    expect(result.stdout).not.toContain('api_key');
  });

  it('rejects a malformed log shape', () => {
    const result = runLogs({ textPayload: 'unexpected' });
    expect(result.exit).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('AG01_SANITIZED_LOGS_ARRAY_REQUIRED');
  });
});
