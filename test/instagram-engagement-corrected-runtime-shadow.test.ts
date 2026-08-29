import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = path.resolve(
  process.cwd(),
  '.github/workflows/instagram-engagement-corrected-runtime-shadow.yml',
);
const workflow = fs.readFileSync(workflowPath, 'utf8');

describe('Instagram corrected runtime production shadow workflow', () => {
  it('is owner-only, exact-main bound and pinned to the accepted immutable runtime', () => {
    expect(workflow).toContain('github.event.issue.user.login == github.repository_owner');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('CURRENT_MAIN_SHA');
    expect(workflow).toContain('test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('RUNTIME_SOURCE_SHA: 22ca9a0160ad3b08d0e133342256376a8e98cb17');
    expect(workflow).toContain(
      'RUNTIME_IMAGE_DIGEST: sha256:50479566a83448090e9fd8f14c471ca6a79ba3c239eb386e8354379b5c872de6',
    );
  });

  it('keeps all Instagram reply and publication writes disabled', () => {
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');
    expect(workflow).toContain('INSTAGRAM_PUBLICATION_WRITES_ENABLED=false');
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(workflow).not.toContain('INSTAGRAM_PUBLICATION_WRITES_ENABLED=true');
  });

  it(
    'requires exact daemon/webhook candidates and proves both channels without reply side effects',
    () => {
      expect(workflow).toContain('DAEMON_CANDIDATE_TRAFFIC_ROUTING_AUTHORIZED=true');
      expect(workflow).toContain('WEBHOOK_CANDIDATE_TRAFFIC_ROUTING_AUTHORIZED=true');
      expect(workflow).toContain('--to-revisions="${DAEMON_CANDIDATE_REVISION}=100"');
      expect(workflow).toContain('--to-revisions="${WEBHOOK_CANDIDATE_REVISION}=100"');
      expect(workflow).toContain('dist/src/ops/instagram-engagement-shadow-proof.js');
      expect(workflow).toContain('(.channelsVerified | sort == ["COMMENT","DIRECT"])');
      expect(workflow).toContain('.inboundDelivered == true');
      expect(workflow).toContain('.faqResolved == true');
      expect(workflow).toContain('.externalReplyObserved == false');
      expect(workflow).toContain('.replyOutboxEvents == 0');
    },
  );

  it('preserves DRS-safe callback rules and automatic rollback', () => {
    expect(workflow).toContain('--no-invoker-iam-check');
    expect(workflow).toContain('DRS-safe callback must not add allUsers');
    expect(workflow).toContain('Roll back corrected runtime shadow on failure');
    expect(workflow).toContain('--no-default-url');
    expect(workflow).toContain('--invoker-iam-check');
    expect(workflow).toContain('ROLLBACK_ATTEMPTED=true');
  });
});
