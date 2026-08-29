import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = 'scripts/extract-instagram-engagement-cloud-run-evidence.mjs';
const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-production.yml',
  'utf8',
);

function extract(validation: string, entries: unknown[]) {
  return spawnSync(process.execPath, [script, validation], {
    input: JSON.stringify(entries),
    encoding: 'utf8',
  });
}

describe('Instagram engagement Cloud Run shadow evidence extraction', () => {
  it('extracts a direct structured jsonPayload', () => {
    const result = extract('instagram-engagement-readiness', [
      { jsonPayload: { unrelated: true } },
      {
        jsonPayload: {
          validation: 'instagram-engagement-readiness',
          status: 'PASS',
          writesEnabled: false,
        },
      },
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      validation: 'instagram-engagement-readiness',
      status: 'PASS',
      writesEnabled: false,
    });
  });

  it('extracts a JSON textPayload for backward compatibility', () => {
    const result = extract('instagram-engagement-shadow-e2e', [
      {
        textPayload: JSON.stringify({
          validation: 'instagram-engagement-shadow-e2e',
          status: 'PASS',
          writesEnabled: false,
        }),
      },
    ]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { validation?: unknown };
    expect(payload.validation).toBe('instagram-engagement-shadow-e2e');
  });

  it('extracts structured logger message JSON without accepting unrelated payloads', () => {
    const result = extract('instagram-engagement-meta-subscriptions', [
      { jsonPayload: { message: 'not-json' } },
      {
        jsonPayload: {
          message: JSON.stringify({
            validation: 'instagram-engagement-meta-subscriptions',
            status: 'PASS',
            secretsPrinted: false,
          }),
        },
      },
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      validation: 'instagram-engagement-meta-subscriptions',
      status: 'PASS',
      secretsPrinted: false,
    });
  });

  it('fails closed when the requested validation evidence is absent or unsupported', () => {
    const missing = extract('instagram-engagement-readiness', [
      { jsonPayload: { validation: 'other-validator', status: 'PASS' } },
    ]);
    const unsupported = extract('arbitrary-validator', []);

    expect(missing.status).not.toBe(0);
    expect(unsupported.status).not.toBe(0);
  });

  it('requires the production shadow workflow to read full JSON log entries for all validators', () => {
    expect(workflow).not.toContain("--format='value(textPayload)'");
    expect(workflow.match(/--format=json/g)?.length).toBeGreaterThanOrEqual(3);
    expect(workflow).toContain(
      'extract-instagram-engagement-cloud-run-evidence.mjs instagram-engagement-readiness',
    );
    expect(workflow).toContain(
      'extract-instagram-engagement-cloud-run-evidence.mjs instagram-engagement-shadow-e2e',
    );
    expect(workflow).toContain(
      'extract-instagram-engagement-cloud-run-evidence.mjs instagram-engagement-meta-subscriptions',
    );
  });
});
