import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = 'scripts/marketing-autopilot-scheduler.mjs';
const workflow = readFileSync('.github/workflows/marketing-autopilot-publication.yml', 'utf8');
const policy = JSON.parse(
  readFileSync('control/marketing-autopilot-scheduler-policy.json', 'utf8'),
) as {
  dailyRollout?: {
    canaryContentItemId?: string;
    canaryScheduledAt?: string;
    rollForwardFromContentItemId?: string;
    rollForwardReason?: string;
    promoteToLimitedAfterVerifiedCanary?: boolean;
    generalAutonomy?: boolean;
    limited?: { generalAutonomy?: boolean };
  };
  standingAuthorization?: {
    authority?: string;
    allowCopyMutation?: boolean;
    allowAssetMutation?: boolean;
  };
};

const productionCanaryId = 'MKT-20260916-SUNSET-STORY-2000';
const canaryId = 'MKT-20260916-SUNSET-FEED-0900';
const storyId = 'MKT-20260916-SUNSET-STORY-1100';
const feedSha = '1c6c961dff3ed10ce0edfa13e2096c2849ade51ff99ade6a6fe14688cd2d1226';
const storySha = 'c5fb0667575754c53c06e16fdda44db822dc0753f257c88ae8795f88ce564dda';
const productionCanarySha = 'e17915b45526be8619eb72da91c3c676d4e8a0c7e0d3d1235a8e53204b2de93c';

function feedRow(overrides: Record<string, string> = {}) {
  return {
    content_item_id: canaryId,
    scheduled_at: '2026-09-16T09:00:00-03:00',
    timezone: 'America/Bahia',
    operation: 'SUNSET',
    channel: 'INSTAGRAM',
    format: 'FEED',
    message: 'Quando o sol baixa, a música assume o ritmo e conduz o Sunset até a noite.',
    cta: 'Celebre a vida com a gente.',
    status: 'PRODUCED',
    creative_id: 'CR-MKT-20260905-SUNSET-FEED-1500-V1',
    copy_id: 'CP-MKT-20260905-SUNSET-FEED-1500-V1',
    approval_status: 'APPROVED',
    approval_mode: 'EXPLICIT_APPROVAL',
    publication_id: '',
    provider_external_id: '',
    provider_status: '',
    correlation_id: 'CORR-MKT-20260916-SUNSET-FEED-0900-GCP-AUTOPILOT-V1',
    master_asset_id: 'MM-SUN-0299-FEED4X5-V1',
    master_drive_file_id: '1i6plOCU7RnuMeFm5jdCQAY7rcb5LJM2q',
    master_status: 'MASTER_READY',
    story_creative_id: '',
    story_drive_file_id: '',
    story_status: '',
    registry_revision: 'MKTREG-GCP-AUTOPILOT-20260916-0900-V1',
    scheduling_status: 'CANARY_READY',
    scheduling_policy: 'TOCA_MARKETING_AUTOPILOT_GCP_SCHEDULER_V1',
    creative_standard_id: 'SUNSET_FEED_PHOTO_V1',
    creative_standard_version: '1.0',
    brand_asset_id: '',
    creative_truth_policy_id: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    brand_integrity_status: 'PASSED',
    venue_fidelity_status: 'PASSED',
    quality_gate_status: 'PASSED',
    exact_asset_binding: 'TRUE',
    output_sha256: feedSha,
    ...overrides,
  };
}

function storyRow(overrides: Record<string, string> = {}) {
  return {
    content_item_id: storyId,
    scheduled_at: '2026-09-16T11:00:00-03:00',
    timezone: 'America/Bahia',
    operation: 'SUNSET',
    channel: 'INSTAGRAM',
    format: 'STORY',
    message: 'A Toca começa antes do pôr do sol. Deck, vegetação e mar fazem parte da chegada.',
    cta: 'Chegue cedo. Olhe em volta.',
    status: 'PRODUCED',
    creative_id: 'CR-MKT-20260903-SUNSET-STORY-1600-BATCH1',
    copy_id: 'CP-MKT-20260903-SUNSET-STORY-1600-BATCH1',
    approval_status: 'APPROVED',
    approval_mode: 'EXPLICIT_APPROVAL',
    publication_id: '',
    provider_external_id: '',
    provider_status: '',
    correlation_id: 'CORR-MKT-20260916-SUNSET-STORY-1100-GCP-AUTOPILOT-V1',
    master_asset_id: '',
    master_drive_file_id: '',
    master_status: '',
    story_creative_id: 'SC-MKT-20260903-SUNSET-STORY-1600-V1',
    story_drive_file_id: '15d2CjMtd_oZrfiV45SKzhfjNE97fD-Ns',
    story_status: 'APPROVED',
    registry_revision: 'MKTREG-GCP-AUTOPILOT-20260916-1100-V1',
    scheduling_status: 'LIMITED_READY_AFTER_CANARY',
    scheduling_policy: 'TOCA_MARKETING_AUTOPILOT_GCP_SCHEDULER_V1',
    creative_standard_id: 'SUNSET_STORY_V1',
    creative_standard_version: '2.1',
    brand_asset_id: 'BRAND-TOCA-WHITE-VERTICAL-V1',
    creative_truth_policy_id: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    brand_integrity_status: 'PASSED',
    venue_fidelity_status: 'PASSED',
    quality_gate_status: 'PREVIEW_QA_PASSED',
    exact_asset_binding: 'TRUE',
    output_sha256: storySha,
    ...overrides,
  };
}

function productionCanaryStoryRow(overrides: Record<string, string> = {}) {
  return {
    content_item_id: productionCanaryId,
    scheduled_at: '2026-09-16T20:00:00-03:00',
    timezone: 'America/Bahia',
    operation: 'SUNSET',
    channel: 'INSTAGRAM',
    format: 'STORY',
    message: 'Daqui, o céu vira parte da experiência.',
    cta: 'Celebre a vida com a gente.',
    status: 'PRODUCED',
    creative_id: 'CR-MKT-20260903-SUNSET-STORY-1100-BATCH1',
    copy_id: 'CP-MKT-20260903-SUNSET-STORY-1100-BATCH1',
    approval_status: 'APPROVED',
    approval_mode: 'EXPLICIT_APPROVAL',
    publication_id: '',
    provider_external_id: '',
    provider_status: '',
    correlation_id: 'CORR-MKT-20260916-SUNSET-STORY-2000-GCP-AUTOPILOT-V1',
    master_asset_id: '',
    master_drive_file_id: '',
    master_status: '',
    story_creative_id: 'SC-MKT-20260903-SUNSET-STORY-1100-V1',
    story_drive_file_id: '1ma-_lO9LME3E6f_MQu0kqyfGjZd7vS9j',
    story_status: 'APPROVED',
    registry_revision: 'MKTREG-GCP-AUTOPILOT-20260916-2000-V1',
    scheduling_status: 'LIMITED_READY_AFTER_CANARY',
    scheduling_policy: 'TOCA_MARKETING_AUTOPILOT_GCP_SCHEDULER_V1',
    creative_standard_id: 'SUNSET_STORY_V1',
    creative_standard_version: '2.1',
    brand_asset_id: 'BRAND-TOCA-WHITE-VERTICAL-V1',
    creative_truth_policy_id: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    brand_integrity_status: 'PASSED',
    venue_fidelity_status: 'PASSED',
    quality_gate_status: 'PREVIEW_QA_PASSED',
    exact_asset_binding: 'TRUE',
    output_sha256: productionCanarySha,
    ...overrides,
  };
}

function publishedCanary() {
  return feedRow({
    status: 'PUBLISHED',
    publication_id: '17900000000000001',
    provider_external_id: '17900000000000001',
    provider_status: 'PUBLISHED',
    scheduling_status: 'PUBLISHED_VERIFIED',
  });
}

function runScheduler({
  mode = 'scan',
  now,
  rows,
  extraEnv = {},
  useProductionPolicy = false,
}: {
  mode?: string;
  now: string;
  rows: Array<Record<string, string>>;
  extraEnv?: Record<string, string>;
  useProductionPolicy?: boolean;
}) {
  const directory = mkdtempSync(join(tmpdir(), 'toca-daily-autopilot-'));
  const fixture = join(directory, 'registry.json');
  const policyFixture = join(directory, 'policy.json');
  writeFileSync(fixture, `${JSON.stringify(rows)}\n`, 'utf8');
  const testPolicy = JSON.parse(JSON.stringify(policy)) as typeof policy;
  if (!testPolicy.dailyRollout) throw new Error('AUTOPILOT_TEST_DAILY_ROLLOUT_REQUIRED');
  if (!useProductionPolicy) {
    testPolicy.dailyRollout.canaryContentItemId = canaryId;
    testPolicy.dailyRollout.canaryScheduledAt = '2026-09-16T09:00:00-03:00';
  }
  writeFileSync(policyFixture, `${JSON.stringify(testPolicy)}\n`, 'utf8');
  return spawnSync('node', [script, mode], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      MARKETING_AUTOPILOT_REGISTRY_FIXTURE: fixture,
      MARKETING_AUTOPILOT_POLICY_PATH: policyFixture,
      MARKETING_AUTOPILOT_NOW: now,
      ...extraEnv,
    },
  });
}

function parseOutput(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function readStringPath(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : undefined;
}

describe('Marketing Autopilot daily scheduler restoration', () => {
  it('keeps manual execution PRECHECK-only and daily autonomy bounded', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('workflow_dispatch|push) mode=PRECHECK');
    expect(workflow).not.toContain('REQUESTED_MODE');
    expect(policy.dailyRollout).toMatchObject({
      canaryContentItemId: productionCanaryId,
      canaryScheduledAt: '2026-09-16T20:00:00-03:00',
      rollForwardFromContentItemId: 'MKT-20260916-SUNSET-STORY-1600',
      rollForwardReason: 'PREVIOUS_CANARY_WINDOW_EXPIRED_NO_SCHEDULE_RUN',
      promoteToLimitedAfterVerifiedCanary: true,
      generalAutonomy: false,
      limited: { generalAutonomy: false },
    });
    expect(policy.standingAuthorization).toMatchObject({
      authority: 'USER_EXPLICIT_DAILY_PUBLICATION_AUTHORIZATION_2026-09-16',
      allowCopyMutation: false,
      allowAssetMutation: false,
    });
  });

  it('selects the production 20:00 Story as the only CANARY candidate', () => {
    const result = runScheduler({
      now: '2026-09-16T19:58:00-03:00',
      rows: [productionCanaryStoryRow()],
      useProductionPolicy: true,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(parseOutput(result.stdout)).toMatchObject({
      status: 'READY',
      rolloutPhase: 'CANARY',
      canaryVerified: false,
      candidate: {
        contentItemId: productionCanaryId,
        scheduledAt: '2026-09-16T20:00:00-03:00',
        waitSeconds: 120,
        format: 'STORY',
        expectedAssetSha256: productionCanarySha,
      },
    });
  });

  it('builds the production 20:00 Story command in CANARY with exact approved binding', () => {
    const targetCodeSha = '3'.repeat(40);
    const result = runScheduler({
      mode: 'build-command',
      now: '2026-09-16T20:00:00-03:00',
      rows: [productionCanaryStoryRow()],
      useProductionPolicy: true,
      extraEnv: {
        MARKETING_AUTOPILOT_CONTENT_ITEM_ID: productionCanaryId,
        MARKETING_AUTOPILOT_TARGET_CODE_SHA: targetCodeSha,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(parseOutput(result.stdout)).toMatchObject({
      status: 'COMMAND_READY',
      rolloutPhase: 'CANARY',
      command: {
        action: 'PUBLISH_NOW',
        contentItemId: productionCanaryId,
        format: 'STORY_IMAGE',
        assetId: 'SC-MKT-20260903-SUNSET-STORY-1100-V1',
        driveFileId: '1ma-_lO9LME3E6f_MQu0kqyfGjZd7vS9j',
        expectedAssetSha256: productionCanarySha,
        caption: 'Daqui, o céu vira parte da experiência.\n\nCelebre a vida com a gente.',
        targetCodeSha,
        creativeTruthBinding: {
          qualityGateStatus: 'PREVIEW_QA_PASSED',
          exactAssetBinding: true,
        },
        schedulerBinding: {
          rolloutPhase: 'CANARY',
          notBefore: '2026-09-16T20:00:00-03:00',
          expiresAt: '2026-09-16T20:30:00-03:00',
        },
      },
    });
  });

  it('selects only the 09:00 canary before any provider-verified publication exists', () => {
    const result = runScheduler({
      now: '2026-09-16T08:58:00-03:00',
      rows: [feedRow(), storyRow()],
    });
    expect(result.status, result.stderr).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output).toMatchObject({
      status: 'READY',
      rolloutPhase: 'CANARY',
      canaryVerified: false,
      candidate: {
        contentItemId: canaryId,
        scheduledAt: '2026-09-16T09:00:00-03:00',
        waitSeconds: 120,
        expectedAssetSha256: feedSha,
      },
    });
    expect(readStringPath(output, ['candidate', 'registrySnapshotSha256'])).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('builds a fresh feed command with exact approved copy and no legacy CTA synthesis', () => {
    const targetCodeSha = '1'.repeat(40);
    const result = runScheduler({
      mode: 'build-command',
      now: '2026-09-16T09:00:00-03:00',
      rows: [feedRow(), storyRow()],
      extraEnv: {
        MARKETING_AUTOPILOT_CONTENT_ITEM_ID: canaryId,
        MARKETING_AUTOPILOT_TARGET_CODE_SHA: targetCodeSha,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(parseOutput(result.stdout)).toMatchObject({
      status: 'COMMAND_READY',
      rolloutPhase: 'CANARY',
      command: {
        action: 'PUBLISH_NOW',
        contentItemId: canaryId,
        format: 'FEED_IMAGE',
        assetId: 'MM-SUN-0299-FEED4X5-V1',
        driveFileId: '1i6plOCU7RnuMeFm5jdCQAY7rcb5LJM2q',
        expectedAssetSha256: feedSha,
        caption:
          'Quando o sol baixa, a música assume o ritmo e conduz o Sunset até a noite.\n\nCelebre a vida com a gente.',
        targetCodeSha,
        approvalMode: 'EXPLICIT_APPROVAL',
        approvalStatus: 'APPROVED',
        rightsClearance: {
          authority: 'USER_EXPLICIT_DAILY_PUBLICATION_AUTHORIZATION_2026-09-16',
          assetSha256: feedSha,
        },
        creativeTruthBinding: { qualityGateStatus: 'PASSED', exactAssetBinding: true },
        schedulerBinding: {
          source: 'MARKETING_AUTOPILOT_GCP',
          rolloutPhase: 'CANARY',
          notBefore: '2026-09-16T09:00:00-03:00',
          expiresAt: '2026-09-16T09:30:00-03:00',
        },
      },
    });
    expect(result.stdout).not.toContain('Ingressos limitados!');
  });

  it('does not promote to LIMITED from a merely approved canary', () => {
    const result = runScheduler({
      now: '2026-09-16T10:58:00-03:00',
      rows: [feedRow(), storyRow()],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(parseOutput(result.stdout)).toMatchObject({
      status: 'NO_CANDIDATE',
      rolloutPhase: 'CANARY',
      canaryVerified: false,
      rejected: [{ contentItemId: canaryId, reason: 'STALE_WINDOW' }],
    });
  });

  it('promotes automatically to LIMITED only after verified provider reconciliation', () => {
    const result = runScheduler({
      now: '2026-09-16T10:58:00-03:00',
      rows: [publishedCanary(), storyRow()],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(parseOutput(result.stdout)).toMatchObject({
      status: 'READY',
      rolloutPhase: 'LIMITED',
      canaryVerified: true,
      candidate: {
        contentItemId: storyId,
        scheduledAt: '2026-09-16T11:00:00-03:00',
        waitSeconds: 120,
      },
    });
  });

  it('builds Story publication from story_creative_id and exact 9:16 final', () => {
    const result = runScheduler({
      mode: 'build-command',
      now: '2026-09-16T11:00:00-03:00',
      rows: [publishedCanary(), storyRow()],
      extraEnv: {
        MARKETING_AUTOPILOT_CONTENT_ITEM_ID: storyId,
        MARKETING_AUTOPILOT_TARGET_CODE_SHA: '2'.repeat(40),
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(parseOutput(result.stdout)).toMatchObject({
      status: 'COMMAND_READY',
      rolloutPhase: 'LIMITED',
      command: {
        format: 'STORY_IMAGE',
        assetId: 'SC-MKT-20260903-SUNSET-STORY-1600-V1',
        driveFileId: '15d2CjMtd_oZrfiV45SKzhfjNE97fD-Ns',
        expectedAssetSha256: storySha,
        creativeTruthBinding: { qualityGateStatus: 'PREVIEW_QA_PASSED' },
        schedulerBinding: { rolloutPhase: 'LIMITED' },
      },
    });
  });

  it('treats an unqualified Sheets clock as America/Bahia wall time', () => {
    const result = runScheduler({
      now: '2026-09-16T08:59:00-03:00',
      rows: [feedRow({ scheduled_at: '2026-09-16 09:00:00' }), storyRow()],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(parseOutput(result.stdout)).toMatchObject({
      candidate: { scheduledAt: '2026-09-16T09:00:00-03:00', waitSeconds: 60 },
    });
  });

  it('rejects an unapproved Story final instead of falling back to a source asset', () => {
    const result = runScheduler({
      now: '2026-09-16T11:00:00-03:00',
      rows: [publishedCanary(), storyRow({ story_status: 'PENDING' })],
    });
    expect(result.status, result.stderr).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output).toMatchObject({ status: 'NO_CANDIDATE', rolloutPhase: 'LIMITED' });
    if (typeof output !== 'object' || output === null || !('rejected' in output)) {
      throw new Error('AUTOPILOT_TEST_REJECTIONS_MISSING');
    }
    const rejected = (output as { rejected?: unknown }).rejected;
    expect(Array.isArray(rejected)).toBe(true);
    const storyRejected = (rejected as unknown[]).some((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const record = item as Record<string, unknown>;
      return record.contentItemId === storyId && record.reason === 'AUTOPILOT_STORY_STATUS_INVALID';
    });
    expect(storyRejected).toBe(true);
  });
});
