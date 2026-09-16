import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = 'scripts/marketing-autopilot-scheduler.mjs';
const contentItemId = 'MKT-20260917-SUNSET-FEED-0900';
const expectedSha = 'a495fa29db54dc2af24700b0556e8a6d1fb01472c333067c91ee6d613525e4e6';

function canonicalRow(overrides: Record<string, string> = {}) {
  return {
    content_item_id: contentItemId,
    scheduled_at: '2026-09-17T09:00:00-03:00',
    timezone: 'America/Bahia',
    operation: 'SUNSET',
    channel: 'INSTAGRAM',
    format: 'FEED',
    message:
      'O fim de tarde começa no detalhe: um bom drink, a vista de Morro e o tempo desacelerando na Toca.',
    cta: 'Salve este convite e venha viver o Sunset.',
    status: 'PRODUCED',
    creative_id: 'CR-MKT-20260903-SUNSET-FEED-0900-V1',
    copy_id: 'CP-MKT-20260903-SUNSET-FEED-0900-V1',
    approval_status: 'APPROVED',
    approval_mode: 'EXPLICIT_APPROVAL',
    publication_id: '',
    provider_external_id: '',
    correlation_id: 'CORR-MKT-20260917-SUNSET-FEED-0900-ROLLOVER-V1',
    master_asset_id: 'MM-SUN-0268-FEED4X5-V1',
    master_drive_file_id: '1uFK4y1fqUHi-m4qn6m-TB-ehBC0Y7JOK',
    master_status: 'MASTER_READY',
    creative_truth_policy_id: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    brand_integrity_status: 'PASSED',
    venue_fidelity_status: 'PASSED',
    quality_gate_status: 'PASSED',
    exact_asset_binding: 'TRUE',
    output_sha256: expectedSha,
    ...overrides,
  };
}

function runScheduler({
  mode = 'scan',
  now,
  row = canonicalRow(),
  extraEnv = {},
}: {
  mode?: string;
  now: string;
  row?: Record<string, string>;
  extraEnv?: Record<string, string>;
}) {
  const directory = mkdtempSync(join(tmpdir(), 'toca-autopilot-'));
  const fixture = join(directory, 'registry.json');
  writeFileSync(fixture, `${JSON.stringify([row])}\n`, 'utf8');
  return spawnSync('node', [script, mode], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      MARKETING_AUTOPILOT_REGISTRY_FIXTURE: fixture,
      MARKETING_AUTOPILOT_NOW: now,
      ...extraEnv,
    },
  });
}

function parseOutput(value: string): unknown {
  return JSON.parse(value) as unknown;
}

describe('Marketing Autopilot scheduler restoration', () => {
  it('prepares inside the bounded lead window without declaring the item due early', () => {
    const result = runScheduler({ now: '2026-09-17T08:58:00-03:00' });
    expect(result.status, result.stderr).toBe(0);
    expect(parseOutput(result.stdout)).toMatchObject({
      status: 'READY',
      candidate: {
        contentItemId,
        scheduledAt: '2026-09-17T09:00:00-03:00',
        waitSeconds: 120,
        expectedAssetSha256: expectedSha,
      },
    });
  });

  it('builds a fresh GCP-specific command only when the publication is due', () => {
    const targetCodeSha = '1'.repeat(40);
    const result = runScheduler({
      mode: 'build-command',
      now: '2026-09-17T09:00:00-03:00',
      extraEnv: {
        MARKETING_AUTOPILOT_CONTENT_ITEM_ID: contentItemId,
        MARKETING_AUTOPILOT_TARGET_CODE_SHA: targetCodeSha,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(parseOutput(result.stdout)).toMatchObject({
      status: 'COMMAND_READY',
      command: {
        action: 'PUBLISH_NOW',
        contentItemId,
        scheduledAt: '2026-09-17T09:00:00-03:00',
        targetCodeSha,
        expectedAssetSha256: expectedSha,
        approvalMode: 'EXPLICIT_APPROVAL',
        approvalStatus: 'APPROVED',
        publicationIntent: 'SHARE_NOW',
        idempotencyKey: `GCP-AUTOPILOT-${contentItemId}-${expectedSha.slice(0, 12)}-V1`,
        creativeTruthBinding: { exactAssetBinding: true },
        brandDeterminism: { status: 'VERIFIED' },
        rightsClearance: { status: 'CLEARED' },
        schedulerBinding: {
          source: 'MARKETING_AUTOPILOT_GCP',
          rolloutPhase: 'CANARY',
          notBefore: '2026-09-17T09:00:00-03:00',
          expiresAt: '2026-09-17T09:30:00-03:00',
        },
      },
    });
    expect(result.stdout).not.toContain('GITHUB_NATIVE');
  });

  it('refuses to build a provider command before scheduled_at', () => {
    const result = runScheduler({
      mode: 'build-command',
      now: '2026-09-17T08:59:59-03:00',
      extraEnv: {
        MARKETING_AUTOPILOT_CONTENT_ITEM_ID: contentItemId,
        MARKETING_AUTOPILOT_TARGET_CODE_SHA: '2'.repeat(40),
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AUTOPILOT_PUBLICATION_NOT_DUE');
  });

  it('rejects an expired publication window rather than retrying late', () => {
    const result = runScheduler({ now: '2026-09-17T09:30:01-03:00' });
    expect(result.status, result.stderr).toBe(0);
    expect(parseOutput(result.stdout)).toMatchObject({
      status: 'NO_CANDIDATE',
      rejected: [{ contentItemId, reason: 'STALE_WINDOW' }],
    });
  });

  it('rejects missing approval and never manufactures APPROVED state', () => {
    const result = runScheduler({
      now: '2026-09-17T09:00:00-03:00',
      row: canonicalRow({ approval_status: 'PENDING' }),
    });
    expect(parseOutput(result.stdout)).toMatchObject({
      status: 'NO_CANDIDATE',
      rejected: [{ contentItemId, reason: 'AUTOPILOT_APPROVAL_NOT_APPROVED:PENDING' }],
    });
  });

  it('rejects exact-asset drift before an execution envelope exists', () => {
    const result = runScheduler({
      now: '2026-09-17T09:00:00-03:00',
      row: canonicalRow({ output_sha256: '0'.repeat(64) }),
    });
    expect(parseOutput(result.stdout)).toMatchObject({
      status: 'NO_CANDIDATE',
      rejected: [{ contentItemId, reason: 'AUTOPILOT_OUTPUT_SHA256_BINDING_MISMATCH' }],
    });
  });

  it('rejects any item that already has provider evidence', () => {
    const result = runScheduler({
      now: '2026-09-17T09:00:00-03:00',
      row: canonicalRow({
        publication_id: '17899999999999999',
        provider_external_id: '17899999999999999',
      }),
    });
    expect(parseOutput(result.stdout)).toMatchObject({
      status: 'NO_CANDIDATE',
      rejected: [{ contentItemId, reason: 'AUTOPILOT_PUBLICATION_ID_ALREADY_PRESENT' }],
    });
  });
});
