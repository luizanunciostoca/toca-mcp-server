import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-readonly-trace.yml',
  'utf8',
);
const script = readFileSync('scripts/diagnose-instagram-engagement-shadow-readonly.mjs', 'utf8');
const diagnosticDockerfile = readFileSync(
  'Dockerfile.instagram-engagement-shadow-readonly-trace',
  'utf8',
);

const workflowGuards = [
  'PRODUCTION DIAGNOSTIC AUTHORIZATION',
  'AUTHORIZED_DIAGNOSTIC_SHA=',
  'INSTAGRAM_ENGAGEMENT_SHADOW_READONLY_TRACE=AUTHORIZED',
  'CLOUD_RUN_EPHEMERAL_JOB_AUTHORIZED=true',
  'ARTIFACT_REGISTRY_DIAGNOSTIC_IMAGE_AUTHORIZED=true',
  'DATABASE_MUTATIONS_AUTHORIZED=false',
  'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
  'callbackClosed:true',
  'legacyAllUsersInvoker:false',
  'daemonEngagementWritesEnabled:false',
  'webhookEngagementWritesEnabled:false',
];

const traceSignals = [
  'meta_webhook_events',
  "sender_scoped_id like 'shadow-proof-comment-sender-%'",
  "event_type = 'instagram.engagement.inbound.v1'",
  'event_outbox_delivery_attempts',
  'instagram_engagement_actions',
  'last_error_code',
  'currentDueInboundBacklog',
  'rawSenderPrinted: false',
  'rawMessagePrinted: false',
  'secretsPrinted: false',
  'databaseMutationPerformed: false',
];

const diagnoses = [
  'META_SYNTHETIC_COMMENT_NOT_FOUND',
  'INBOUND_OUTBOX_NOT_ENQUEUED',
  'LATE_ACTION_OBSERVED_AFTER_PROOF_WINDOW',
  'ACTION_EXISTS_WITHIN_RUN_WINDOW',
  'INBOUND_PENDING_NOT_CLAIMED',
  'PROCESSOR_FAILED_RETRYABLE',
  'PROCESSOR_DEAD_LETTER',
  'INBOUND_CLAIM_STUCK',
  'ACTION_MISSING_AFTER_DELIVERY_INVARIANT_BREACH',
  'INBOUND_STATE_UNKNOWN',
];

describe('Instagram engagement shadow read-only trace', () => {
  it('keeps the diagnostic fail-closed', () => {
    for (const token of workflowGuards) {
      expect(workflow).toContain(token);
    }
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(workflow).not.toContain('--no-invoker-iam-check');
    expect(workflow).not.toContain('update-traffic');
    expect(workflow).not.toContain('gcloud secrets versions access');
    expect(workflow).not.toContain('gcloud run services update');
  });

  it('uses authenticated least-privilege GitHub reads and local issue-event authorization', () => {
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('issues: read');
    expect(workflow).toContain('GH_TOKEN: ${{ github.token }}');
    expect(workflow).toContain('jq \\.issue\\ "$GITHUB_EVENT_PATH"');
    expect(workflow).toContain('-H "Authorization: Bearer $GH_TOKEN"');
    expect(workflow).toContain('mkdir -p engagement-evidence');
    expect(workflow).toContain('toca.instagram-engagement.shadow-readonly-trace-attempt.v1');
  });

  it('injects the database secret only into a runtime-SA ephemeral job', () => {
    expect(workflow).toContain(
      'GCP_RUNTIME_SERVICE_ACCOUNT: toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com',
    );
    expect(workflow).toContain('gcloud run jobs deploy "$JOB_NAME"');
    expect(workflow).toContain('--service-account "$GCP_RUNTIME_SERVICE_ACCOUNT"');
    expect(workflow).toContain('--set-cloudsql-instances "$CLOUD_SQL_INSTANCE"');
    expect(workflow).toContain('--set-secrets "DATABASE_URL=$DATABASE_SECRET_ID:latest"');
    expect(workflow).toContain('gcloud run jobs delete "$JOB_NAME"');
  });

  it('builds an isolated diagnostic image from the immutable engagement runtime', () => {
    expect(diagnosticDockerfile).toContain(
      'sha256:4f7f9775fea909416341b18e0bc042fe0318037d6c1791fc7bcb4e121af24e30',
    );
    expect(diagnosticDockerfile).toContain(
      'scripts/diagnose-instagram-engagement-shadow-readonly.mjs',
    );
    expect(diagnosticDockerfile).not.toContain('COPY src');
    expect(diagnosticDockerfile).not.toContain('CMD ["node", "dist/src/http.js"]');
  });

  it('uses only a read-only database transaction', () => {
    expect(script).toContain('begin transaction read only');
    expect(script).toContain("await client.query('rollback')");
    for (const phrase of [
      'insert into event_outbox',
      'update event_outbox',
      'delete from event_outbox',
      'update instagram_engagement_actions',
      'delete from instagram_engagement_actions',
    ]) {
      expect(script.toLowerCase()).not.toContain(phrase);
    }
  });

  it('traces the synthetic comment without raw content', () => {
    for (const token of traceSignals) {
      expect(script).toContain(token);
    }
  });

  it('classifies the remaining failure modes', () => {
    for (const diagnosis of diagnoses) {
      expect(script).toContain(diagnosis);
    }
  });
});
