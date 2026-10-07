import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

const readonlyWorkflow = read(
  '.github/workflows/instagram-engagement-webhook-callback-readonly.yml',
);
const restoreWorkflow = read(
  '.github/workflows/instagram-engagement-webhook-callback-restore.yml',
);
const deployWorkflow = read('.github/workflows/deploy-gcp.yml');
const ingressVerifier = read('scripts/verify-instagram-engagement-webhook-ingress.sh');

const promotionWorkflows = [
  read('.github/workflows/instagram-engagement-limited-activation.yml'),
  read('.github/workflows/instagram-engagement-comment-limited-promotion.yml'),
  read('.github/workflows/instagram-engagement-faq-expansion-limited-refresh.yml'),
  read('.github/workflows/instagram-engagement-ag01-fallback-limited-activation.yml'),
];

const callbackWriterWorkflows = [
  read('.github/workflows/instagram-engagement-final-shadow-proof.yml'),
  read('.github/workflows/instagram-engagement-shadow-production.yml'),
  read('.github/workflows/instagram-engagement-shadow-proof-recovery.yml'),
  read('.github/workflows/instagram-engagement-corrected-shadow-proof-retry.yml'),
  read('.github/workflows/instagram-engagement-corrected-runtime-shadow.yml'),
  read('.github/workflows/instagram-engagement-shadow-candidate-recovery.yml'),
  read('.github/workflows/instagram-engagement-shadow-unique-candidate-recovery.yml'),
];

function expectOrdered(source: string, markers: readonly string[]): void {
  let previous = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker);
    expect(current, marker).toBeGreaterThan(previous);
    previous = current;
  }
}

describe('Instagram engagement webhook callback control', () => {
  it('serializes every Instagram callback writer and promotion on one mutex', () => {
    const shared = 'group: instagram-engagement-webhook-callback-control';

    expect(readonlyWorkflow).toContain(shared);
    expect(restoreWorkflow).toContain(shared);
    for (const workflow of [...promotionWorkflows, ...callbackWriterWorkflows]) {
      expect(workflow).toContain(shared);
      expect(workflow).toContain('cancel-in-progress: false');
    }

    expect(deployWorkflow).toContain(
      "inputs.environment == 'production' && 'instagram-engagement-webhook-callback-control'",
    );
    expect(deployWorkflow).toContain("format('deploy-gcp-next-{0}', inputs.environment)");
  });

  it('classifies restricted ingress and never reports a failed readback as PASS', () => {
    for (const marker of [
      'run.googleapis.com/ingress',
      'BLOCKED_INGRESS_RESTRICTED',
      'INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED',
      'READBACK_OUTCOME: ${{ steps.readback.outcome }}',
      'if [[ "$READBACK_OUTCOME" == success ]]; then STATUS=PASS; fi',
      '"WEBHOOK_CALLBACK_READONLY_STATUS=$STATUS"',
      'CALLBACK_CLASSIFICATION=${CLASSIFICATION:-READBACK_FAILED}',
      'AUTHORIZATION_STATE=CONSUMED_AND_CLOSED',
    ]) {
      expect(readonlyWorkflow).toContain(marker);
    }

    expect(readonlyWorkflow).not.toContain(
      'gcloud run services update "$WEBHOOK_SERVICE_NAME"',
    );
  });

  it('limits repair to reversible callback posture and consumes authority before mutation', () => {
    for (const marker of [
      'MUTATION_SCOPE=INGRESS_DEFAULT_URL_INVOKER_IAM_CHECK_ONLY',
      'TRAFFIC_MUTATION_AUTHORIZED=false',
      'IMAGE_MUTATION_AUTHORIZED=false',
      'REVISION_DEPLOY_AUTHORIZED=false',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'PROVIDER_READS_AUTHORIZED=true',
      'PROVIDER_METHODS=GET_ONLY',
      'PROVIDER_WRITES_AUTHORIZED=false',
      'NEW_PAID_RESOURCES_AUTHORIZED=false',
      'GENERAL_AUTONOMY_AUTHORIZED=false',
      'ROLLBACK_REQUIRED=true',
      '--ingress=all',
      '--default-url',
      '--no-invoker-iam-check',
      'PRE_TRAFFIC_SHA',
      'PRE_IAM_SHA',
      'PRE_IMAGE',
    ]) {
      expect(restoreWorkflow).toContain(marker);
    }

    expectOrdered(restoreWorkflow, [
      '      - name: Capture exact service-level prestate',
      '      - name: Consume single-use authorization before mutation',
      '      - name: Restore only the required DRS-safe callback surface',
      '      - name: Read back runtime, DB schema, challenge and Meta subscriptions',
      '      - name: Publish successful repair evidence',
      '      - name: Roll back exact service-level prestate on failure or cancellation',
    ]);

    expect(restoreWorkflow).toContain(
      "if: (failure() || cancelled()) && env.MUTATION_ATTEMPTED == 'true'",
    );
    expect(restoreWorkflow).toContain(
      "if: always() && env.MUTATION_ATTEMPTED == 'true' && (failure() || cancelled())",
    );
    expect(restoreWorkflow).not.toContain('gcloud run services update-traffic');
    expect(restoreWorkflow).not.toContain('gcloud run deploy');
    expect(restoreWorkflow).not.toContain('--member=allUsers');
  });

  it('reuses the canonical zero-new-resource readiness and provider GET-only verifier', () => {
    expect(restoreWorkflow).toContain(
      'bash scripts/verify-instagram-engagement-webhook-ingress.sh',
    );
    for (const marker of [
      'run.googleapis.com/ingress',
      'curl --silent --show-error --connect-timeout 5 --max-time 20',
      'AbortSignal.timeout(10_000)',
      '/subscriptions',
      '/subscribed_apps',
      'CALLBACK_CHALLENGE_PASS=true',
      'PROVIDER_METHODS=GET_ONLY',
      'PROVIDER_WRITES=false',
      'DATABASE_MUTATIONS=false',
      'PERSISTENT_SERVICE_MUTATIONS=false',
      'NEW_PAID_RESOURCE_ALLOCATION=false',
    ]) {
      expect(ingressVerifier).toContain(marker);
    }

    expect(ingressVerifier).not.toContain('gcloud run jobs deploy');
    expect(ingressVerifier).not.toContain('gcloud run jobs execute');
    expect(ingressVerifier).not.toContain("method: 'POST'");
  });

  it('revalidates callback ingress before and after AG-01 cutover', () => {
    const ag01 = promotionWorkflows[3];
    expectOrdered(ag01, [
      '      - name: Verify healthy Instagram webhook ingress before AG-01 mutation',
      '      - name: Stage daemon candidate with grounded fallback at zero traffic',
      '      - name: Cut over exact candidate transactionally and verify LIMITED readback',
      '      - name: Reverify healthy Instagram webhook ingress after AG-01 cutover',
      '      - name: Publish sanitized activation evidence',
    ]);

    const calls = ag01.match(
      /bash scripts\/verify-instagram-engagement-webhook-ingress\.sh/g,
    );
    expect(calls?.length).toBe(2);
  });
});
