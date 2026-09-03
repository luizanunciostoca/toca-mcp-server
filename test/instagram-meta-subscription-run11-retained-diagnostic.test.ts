import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-meta-subscription-run11-retained-diagnostic.yml',
  'utf8',
);

describe('Instagram Meta subscription run11 retained diagnostic', () => {
  it('is exact-source and read-only', () => {
    expect(workflow).toContain("SOURCE_RUN_ID: '33704420071'");
    expect(workflow).toContain('SOURCE_JOB: toca-ig-eng-subscribe-33704420071-1');
    expect(workflow).toContain('SOURCE_EXECUTION: toca-ig-eng-subscribe-33704420071-1-hvh7d');
    expect(workflow).toContain('READ_ONLY_DIAGNOSTIC=true');
    expect(workflow).toContain('SERVICE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('DATABASE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('PROVIDER_READS_AUTHORIZED=false');
    expect(workflow).toContain('PROVIDER_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('gcloud logging read');
    expect(workflow).toContain('gcloud run jobs executions describe');
    expect(workflow).not.toContain('gcloud run jobs deploy');
    expect(workflow).not.toContain('gcloud run services update');
    expect(workflow).not.toContain('gcloud run services deploy');
    expect(workflow).not.toContain('META_ACCESS_TOKEN');
    expect(workflow).not.toContain('graph.facebook.com');
  });

  it('publishes only bounded error markers and explicit non-write evidence', () => {
    expect(workflow).toContain('META_APP_SUBSCRIPTION_FAILED');
    expect(workflow).toContain('META_PAGE_SUBSCRIPTION_FAILED');
    expect(workflow).toContain('META_INSTAGRAM_SUBSCRIPTION_FAILED');
    expect(workflow).toContain('META_SUBSCRIPTION_READBACK_FAILED');
    expect(workflow).toContain('META_SUBSCRIPTION_READBACK_APP_MISSING');
    expect(workflow).toContain('rawPayloadPrinted: false');
    expect(workflow).toContain('messageBodiesPrinted: false');
    expect(workflow).toContain('identitiesPrinted: false');
    expect(workflow).toContain('secretsPrinted: false');
    expect(workflow).toContain('providerReadsPerformed: false');
    expect(workflow).toContain('providerWritesPerformed: false');
    expect(workflow).toContain('externalReplyWrites: false');
  });

  it('uses pinned permanent actions', () => {
    expect(workflow).toContain('actions/checkout@11d5960a326750d5838078e36cf38b85af677262');
    expect(workflow).toContain(
      'google-github-actions/auth@c200f3691d83b41bf9bbd8638997a462592937ed',
    );
    expect(workflow).toContain(
      'google-github-actions/setup-gcloud@e427ad8a34f8676edf47cf7d7925499adf3eb74f',
    );
    expect(workflow).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
  });
});
