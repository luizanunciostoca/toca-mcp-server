import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/marketing-autopilot-publication.yml', 'utf8');
const publicationScript = readFileSync('scripts/marketing-publish-now.sh', 'utf8');
const queuePath = 'control/gcp-instagram-publication-queue.json';
const createdDirectories: string[] = [];

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function item(overrides: Record<string, unknown> = {}) {
  const caption = 'Approved registry caption without fast-path CTA mutation.';
  const assetSha = 'a'.repeat(64);
  const contentItemId = 'MKT-TEST-SUNSET-FEED-0900';
  return {
    commandId: 'scheduled-gcp-test-v1',
    contentItemId,
    operation: 'SUNSET',
    channel: 'INSTAGRAM',
    format: 'FEED_IMAGE',
    contentType: 'image/jpeg',
    scheduledAt: '2026-09-17T09:00:00-03:00',
    status: 'SCHEDULED',
    scheduledState: 'SCHEDULED',
    approvalMode: 'EXPLICIT_APPROVAL',
    approvalStatus: 'APPROVED',
    publicationStatus: 'NOT_PUBLISHED',
    canary: true,
    instagramAccountId: '17841402033495654',
    assetId: 'ASSET-SHA256-aaaaaaaaaaaaaaaa',
    driveFileId: '1uFK4y1fqUHi-m4qn6m-TB-ehBC0Y7JOK',
    expectedAssetSha256: assetSha,
    caption,
    captionSha256: sha256(caption),
    correlationId: 'CORR-MKT-TEST-SUNSET-FEED-0900-V1',
    idempotencyKey: 'GCP_SCHEDULED:MKT-TEST-SUNSET-FEED-0900:V1',
    targetCodeSha: 'b'.repeat(40),
    creativeTruthBinding: {
      policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
      standardId: 'SUNSET_FEED_V1',
      creativeId: 'CR-MKT-TEST-SUNSET-FEED-0900-V1',
      outputSha256: assetSha,
      brandIntegrityStatus: 'PASSED',
      venueFidelityStatus: 'PASSED',
      qualityGateStatus: 'PASSED',
      exactAssetBinding: true,
    },
    rightsClearance: {
      status: 'CLEARED',
      scope: 'INSTAGRAM_ORGANIC_PUBLICATION',
      evidenceRef: 'RIGHTS_VERIFIED_VIA_CONTENT_REGISTRY',
      authority: 'TOCA_CONTENT_REGISTRY',
      clearedAt: '2026-09-15T13:34:23-03:00',
      assetSha256: assetSha,
    },
    registrySnapshot: {
      sourceTitle: 'TOCA_OS — MARKETING_AUTOPILOT_CONTENT_REGISTRY_v1.0',
      spreadsheetId: '1r02HLhmnTijFNkmZv4o1yeZPxCEUMXZC_QreDFB6yTw',
      sheetName: 'CONTENT_ITEMS',
      row: 6,
      contentItemId,
      approvalStatus: 'APPROVED',
      scheduledState: 'SCHEDULED',
      publicationStatus: 'NOT_PUBLISHED',
      assetSha256: assetSha,
      captionSha256: sha256(caption),
    },
    ...overrides,
  };
}

function runController(queue: unknown, now: string) {
  const directory = mkdtempSync(join(tmpdir(), 'toca-scheduled-publication-'));
  createdDirectories.push(directory);
  const queueFile = join(directory, 'queue.json');
  const commandFile = join(directory, 'command.json');
  const summaryFile = join(directory, 'summary.json');
  writeFileSync(queueFile, JSON.stringify(queue), 'utf8');
  const result = spawnSync('node', ['scripts/marketing-scheduled-publication-controller.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SCHEDULED_PUBLICATION_QUEUE_PATH: queueFile,
      SCHEDULED_PUBLICATION_COMMAND_PATH: commandFile,
      SCHEDULED_PUBLICATION_SUMMARY_PATH: summaryFile,
      SCHEDULED_PUBLICATION_NOW: now,
    },
    encoding: 'utf8',
  });
  const summary = result.status === 0 ? JSON.parse(readFileSync(summaryFile, 'utf8')) : undefined;
  const command = summary?.due ? JSON.parse(readFileSync(commandFile, 'utf8')) : undefined;
  return { result, summary, command };
}

afterEach(() => {
  while (createdDirectories.length > 0) {
    rmSync(createdDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('GCP scheduled Instagram publication controller', () => {
  it('ships the canonical queue disabled and empty until a separately pinned canary is approved', () => {
    expect(JSON.parse(readFileSync(queuePath, 'utf8'))).toEqual({
      schemaVersion: 1,
      mode: 'CANARY',
      enabled: false,
      timezone: 'America/Bahia',
      maxDelayMinutes: 30,
      items: [],
    });
  });

  it('does not authenticate or publish when the queue is disabled', () => {
    const { result, summary } = runController(
      {
        schemaVersion: 1,
        mode: 'CANARY',
        enabled: false,
        timezone: 'America/Bahia',
        maxDelayMinutes: 30,
        items: [],
      },
      '2026-09-17T09:00:00-03:00',
    );
    expect(result.status).toBe(0);
    expect(summary).toMatchObject({ due: false, reason: 'QUEUE_DISABLED' });
  });

  it('does not publish before the approved scheduled time', () => {
    const { result, summary } = runController(
      {
        schemaVersion: 1,
        mode: 'CANARY',
        enabled: true,
        timezone: 'America/Bahia',
        maxDelayMinutes: 30,
        items: [item()],
      },
      '2026-09-17T08:59:59-03:00',
    );
    expect(result.status).toBe(0);
    expect(summary).toMatchObject({ due: false, reason: 'NO_ITEM_DUE' });
  });

  it('generates an exact ephemeral PUBLISH_NOW command only inside the due window', () => {
    const { result, summary, command } = runController(
      {
        schemaVersion: 1,
        mode: 'CANARY',
        enabled: true,
        timezone: 'America/Bahia',
        maxDelayMinutes: 30,
        items: [item()],
      },
      '2026-09-17T09:00:30-03:00',
    );
    expect(result.status, result.stderr).toBe(0);
    expect(summary).toMatchObject({
      due: true,
      contentItemId: 'MKT-TEST-SUNSET-FEED-0900',
      scheduledAt: '2026-09-17T09:00:00-03:00',
      targetCodeSha: 'b'.repeat(40),
    });
    expect(command).toMatchObject({
      action: 'PUBLISH_NOW',
      schedulingPolicy: 'SCHEDULED_GCP',
      publicationIntent: 'SHARE_NOW',
      caption: 'Approved registry caption without fast-path CTA mutation.',
      scheduledAt: '2026-09-17T09:00:00-03:00',
      targetCodeSha: 'b'.repeat(40),
    });
    expect(command.issuedAt).toBe('2026-09-17T09:00:30-03:00');
  });

  it('fails closed on caption drift from the protected registry snapshot', () => {
    const changed = item({ caption: 'Changed after approval.' });
    const { result } = runController(
      {
        schemaVersion: 1,
        mode: 'CANARY',
        enabled: true,
        timezone: 'America/Bahia',
        maxDelayMinutes: 30,
        items: [changed],
      },
      '2026-09-17T09:00:30-03:00',
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SCHEDULED_PUBLICATION_CAPTION_HASH_MISMATCH');
  });

  it('fails closed when an approved item has missed its maximum publication window', () => {
    const { result } = runController(
      {
        schemaVersion: 1,
        mode: 'CANARY',
        enabled: true,
        timezone: 'America/Bahia',
        maxDelayMinutes: 30,
        items: [item()],
      },
      '2026-09-17T09:31:00-03:00',
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SCHEDULED_PUBLICATION_WINDOW_EXPIRED');
  });

  it('fails closed when more than one publication is due in the same cycle', () => {
    const second = item({
      commandId: 'scheduled-gcp-test-v2',
      contentItemId: 'MKT-TEST-SUNSET-FEED-0910',
      scheduledAt: '2026-09-17T09:00:00-03:00',
      correlationId: 'CORR-MKT-TEST-SUNSET-FEED-0910-V1',
      idempotencyKey: 'GCP_SCHEDULED:MKT-TEST-SUNSET-FEED-0910:V1',
      registrySnapshot: {
        ...(item().registrySnapshot as Record<string, unknown>),
        contentItemId: 'MKT-TEST-SUNSET-FEED-0910',
        row: 7,
      },
    });
    const { result } = runController(
      {
        schemaVersion: 1,
        mode: 'LIMITED',
        enabled: true,
        timezone: 'America/Bahia',
        maxDelayMinutes: 30,
        items: [item({ canary: false }), second],
      },
      '2026-09-17T09:00:30-03:00',
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SCHEDULED_PUBLICATION_AMBIGUOUS');
  });
});

describe('GCP scheduled Instagram publication workflow', () => {
  it('runs from protected main on a bounded poll schedule and stays no-op when nothing is due', () => {
    expect(workflow).toContain("cron: '*/15 * * * *'");
    expect(workflow).toContain("test \"$GITHUB_REF\" = 'refs/heads/main'");
    expect(workflow).toContain('test "$live_main" = "$GITHUB_SHA"');
    expect(workflow).toContain("if: steps.selection.outputs.due == 'true'");
  });

  it('uses the same hardened GCP writer and never dispatches the GitHub-native publisher', () => {
    expect(workflow).toContain('PUBLICATION_POLICY_MODE: SCHEDULED');
    expect(workflow).toContain('bash scripts/marketing-publish-now-fixed.sh');
    expect(workflow).toContain('google-github-actions/auth@c200f3691d83b41bf9bbd8638997a462592937ed');
    expect(workflow).toContain('DATABASE_SECRET_VERSION: \'1\'');
    expect(workflow).not.toContain('github-native-instagram-publish-controlled');
    expect(workflow).not.toContain('repository_dispatch');
  });

  it('pins execution code to an ancestor of the exact protected-main queue snapshot', () => {
    expect(workflow).toContain('git merge-base --is-ancestor "$TARGET_CODE_SHA" "$GITHUB_SHA"');
    expect(workflow).toContain('git checkout --detach "$TARGET_CODE_SHA"');
    expect(workflow).toContain('GITHUB_SHA="$AUDITED_CODE_SHA" bash scripts/marketing-publish-now-fixed.sh');
  });

  it('keeps fast-path caption policy separate from scheduled approved-caption policy', () => {
    expect(publicationScript).toContain('PUBLICATION_POLICY_MODE="${PUBLICATION_POLICY_MODE:-FAST_PATH}"');
    expect(publicationScript).toContain('if [ "$PUBLICATION_POLICY_MODE" = "FAST_PATH" ]; then');
    expect(publicationScript).toContain('.schedulingPolicy == "SCHEDULED_GCP"');
    expect(publicationScript).toContain('test "$scheduled_delta" -ge 0');
    expect(publicationScript).toContain('test "$scheduled_delta" -le "$scheduled_max_delay_seconds"');
  });
});
