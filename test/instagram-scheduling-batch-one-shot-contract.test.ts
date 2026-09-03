import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/instagram-scheduling-batch-one-shot.yml', 'utf8');
const command = readFileSync('src/toca-managed-instagram-schedule-batch-command.ts', 'utf8');

describe('Instagram scheduling batch one-shot contract', () => {
  it('requires the exact authorized 48-item batch and never becomes a publication clock', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("confirm_schedule == 'SCHEDULE_AUTHORIZED_48'");
    expect(workflow).toContain("AUTHORIZATION_ISSUE: '523'");
    expect(workflow).toContain(
      'BUNDLE_DRIVE_FILE_ID: 1UyXBwoyT8Hbbho4pl8Bcr513OXDmNnDi',
    );
    expect(workflow).toContain(
      'BUNDLE_SHA256: 9fb7c7cd85fd9ec431316e4cf4c81b31f8b01a5da3117a76deeda74797ec3476',
    );
    expect(workflow).toContain("BUNDLE_ITEM_COUNT: '48'");
    expect(workflow).not.toContain('cron:');
    expect(workflow).not.toContain('media_publish');
    expect(workflow).not.toContain('INSTAGRAM_PUBLICATION_WRITES_ENABLED=true');
  });

  it('stages immutable assets and writes only through the managed scheduler abstraction', () => {
    expect(command).toContain('GcsPublicationAssetStager');
    expect(command).toContain('hashTocaManagedInstagramApprovalDescriptor');
    expect(command).toContain('TocaManagedInstagramScheduler');
    expect(command).toContain('PostgresScheduler');
    expect(command).toContain('await scheduler.schedule(payload)');
    expect(command).toContain("confirmed.status !== 'SCHEDULED'");
    expect(command).toContain('TOCA_SCHEDULE_BATCH_APPROVAL_SHA256_MISMATCH');
    expect(command).not.toContain('insert into scheduled_jobs');
    expect(command).not.toContain('MetaApiClient');
    expect(command).not.toContain('media_publish');
  });

  it('keeps execution fail-closed and removes the temporary Cloud Run Job', () => {
    expect(workflow).toContain('--max-retries 0');
    expect(workflow).toContain('TOCA_SCHEDULE_BATCH_POSTGRES_READBACK=VERIFIED');
    expect(workflow).toContain('- name: Remove one-shot Cloud Run Job');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('gcloud run jobs delete "$BATCH_JOB_NAME"');
    expect(workflow).toContain('NO_DIRECT_SCHEDULED_JOBS_SQL=true');
    expect(workflow).toContain('NO_PROVIDER_CALL_DURING_SCHEDULE_CREATE=true');
  });
});
