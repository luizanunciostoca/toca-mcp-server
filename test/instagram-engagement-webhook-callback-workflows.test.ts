import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

const readonlyWorkflow = read(
  '.github/workflows/instagram-engagement-webhook-callback-readonly.yml',
);
const restoreWorkflow = read(
  '.github/workflows/instagram-engagement-webhook-callback-restore.yml',
);
const verifier = read('scripts/verify-instagram-engagement-webhook-ingress.sh');

const callbackWriters = [
  '.github/workflows/instagram-engagement-final-shadow-proof.yml',
  '.github/workflows/instagram-engagement-shadow-production.yml',
  '.github/workflows/instagram-engagement-corrected-shadow-proof-retry.yml',
  '.github/workflows/instagram-engagement-shadow-proof-recovery.yml',
  '.github/workflows/instagram-engagement-corrected-runtime-shadow.yml',
  '.github/workflows/instagram-engagement-shadow-candidate-recovery.yml',
  '.github/workflows/instagram-engagement-shadow-unique-candidate-recovery.yml',
  '.github/workflows/instagram-engagement-limited-activation.yml',
  '.github/workflows/instagram-engagement-comment-limited-promotion.yml',
  '.github/workflows/instagram-engagement-faq-expansion-limited-refresh.yml',
  '.github/workflows/instagram-engagement-ag01-fallback-limited-activation.yml',
  '.github/workflows/instagram-engagement-webhook-callback-readonly.yml',
  '.github/workflows/instagram-engagement-webhook-callback-restore.yml',
].map(read);

const deploy = read('.github/workflows/deploy-gcp.yml');

function expectOrdered(source: string, markers: readonly string[]): void {
  let prior = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    expect(index, marker).toBeGreaterThan(prior);
    prior = index;
  }
}

describe('Instagram webhook callback governance', () => {
  it('serializes every callback writer and production deploy in one mutex', () => {
    for (const workflow of callbackWriters) {
      expect(workflow).toContain(
        'group: instagram-engagement-webhook-callback-control',
      );
      expect(workflow).toContain('cancel-in-progress: false');
    }

    expect(deploy).toContain(
      "inputs.environment == 'production' && 'instagram-engagement-webhook-callback-control'",
    );
    expect(deploy).toContain('cancel-in-progress: false');
  });

  it('classifies restricted ingress as blocked and never emits false readback PASS', () => {
    for (const marker of [
      'run.googleapis.com/ingress',
      'BLOCKED_INGRESS_RESTRICTED',
      'BLOCKED_DEFAULT_URL_DISABLED',
      'BLOCKED_INVOKER_IAM_CHECK_ENABLED',
      "STATUS=FAIL",
      'if [[ "$READBACK_OUTCOME" == success ]]; then STATUS=PASS; fi',
    ]) {
      expect(readonlyWorkflow).toContain(marker);
    }

    expect(readonlyWorkflow).not.toContain(
      'gcloud run services update "$WEBHOOK_SERVICE_NAME"',
    );
  });

  it('consumes authorization before mutation and scopes the repair tightly', () => {
    for (const marker of [
      'MUTATION_SCOPE=INGRESS_DEFAULT_URL_INVOKER_IAM_CHECK_ONLY',
      'SERVICE_MUTATION_AUTHORIZED=true',
      'TRAFFIC_MUTATION_AUTHORIZED=false',
      'IMAGE_MUTATION_AUTHORIZED=false',
      'REVISION_DEPLOY_AUTHORIZED=false',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'SECRET_PAYLOAD_READS_AUTHORIZED=true',
      'PROVIDER_READS_AUTHORIZED=true',
      'PROVIDER_METHODS=GET_ONLY',
      'PROVIDER_WRITES_AUTHORIZED=false',
      'NEW_PAID_RESOURCES_AUTHORIZED=false',
      'GENERAL_AUTONOMY_AUTHORIZED=false',
    ]) {
      expect(restoreWorkflow).toContain(marker);
    }

    expectOrdered(restoreWorkflow, [
      '      - name: Consume single-use authorization before mutation',
      '      - name: Restore only the required DRS-safe callback surface',
      '      - name: Read back runtime, DB schema, challenge and Meta subscriptions',
      '      - name: Publish successful repair evidence',
      '      - name: Roll back exact service-level prestate on failure or cancellation',
    ]);

    expect(restoreWorkflow).not.toContain('gcloud run services update-traffic');
    expect(restoreWorkflow).not.toContain('gcloud run deploy');
    expect(restoreWorkflow).not.toContain('--member=allUsers');
  });

  it('rolls back failure or cancellation and makes attempted authorization non-reusable', () => {
    expect(restoreWorkflow).toContain(
      "if: (failure() || cancelled()) && env.MUTATION_ATTEMPTED == 'true'",
    );
    expect(restoreWorkflow).toContain(
      'AUTHORIZATION_STATE=CONSUMED_AND_CLOSED',
    );
    expect(restoreWorkflow).toContain(
      'if: always() && env.MUTATION_ATTEMPTED == \'true\' && (failure() || cancelled())',
    );
    expect(restoreWorkflow).toContain('WEBHOOK_CALLBACK_RESTORE_ROLLBACK=PASS');
  });

  it('bounds every network validation after opening the callback', () => {
    expect(verifier).toContain('--connect-timeout 5 --max-time 15');
    expect(verifier).toContain('--connect-timeout 5 --max-time 20');
    expect(verifier).toContain('AbortSignal.timeout(10_000)');
    expect(verifier).toContain("method: 'GET'");
    expect(verifier).not.toContain("method: 'POST'");
  });

  it('proves image and traffic stay unchanged across repair and rollback', () => {
    for (const marker of [
      'test "$CURRENT_IMAGE" = "$EXPECTED_IMAGE"',
      'test "$POST_TRAFFIC_SHA" = "$PRE_TRAFFIC_SHA"',
      'test "$POST_IAM_SHA" = "$PRE_IAM_SHA"',
      'test "$CURRENT_REVISION" = "$EXPECTED_REVISION"',
    ]) {
      expect(restoreWorkflow).toContain(marker);
    }
  });
});
