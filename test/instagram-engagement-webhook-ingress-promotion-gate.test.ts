import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const verifier = readFileSync('scripts/verify-instagram-engagement-webhook-ingress.sh', 'utf8');

const direct = readFileSync(
  '.github/workflows/instagram-engagement-limited-activation.yml',
  'utf8',
);
const comment = readFileSync(
  '.github/workflows/instagram-engagement-comment-limited-promotion.yml',
  'utf8',
);
const faq = readFileSync(
  '.github/workflows/instagram-engagement-faq-expansion-limited-refresh.yml',
  'utf8',
);

const workflows = [direct, comment, faq];

function expectOrdered(source: string, markers: readonly string[]): void {
  let previous = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    expect(index).toBeGreaterThan(previous);
    previous = index;
  }
}

describe('Instagram engagement webhook ingress promotion gate', () => {
  it('proves the complete read-only ingress path before declaring LIMITED healthy', () => {
    const markers = [
      'gcloud run services describe "$WEBHOOK_SERVICE_NAME"',
      'run.googleapis.com/default-url-disabled',
      'run.googleapis.com/invoker-iam-disabled',
      'INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED',
      'META_WEBHOOK_ENABLED',
      'META_WEBHOOK_PERSISTENCE_ENABLED',
      'DATABASE_URL',
      'gcloud run jobs deploy "$JOB"',
      'dist/src/ops/instagram-engagement-ingestion-health-readonly.js',
      'DATABASE_READ_PASS=true',
      'PROVIDER_READ_PASS=true',
      'APP_INSTAGRAM_SUBSCRIPTION_PRESENT=true',
      'APP_CALLBACK_URL_MATCH=true',
      'APP_COMMENTS_FIELD_PRESENT=true',
      'APP_MESSAGES_FIELD_PRESENT=true',
      'PAGE_APP_SUBSCRIPTION_PRESENT=true',
      'PAGE_MESSAGES_FIELD_PRESENT=true',
      'CALLBACK_CHALLENGE_PASS=true',
      'PROVIDER_METHODS=GET_ONLY',
      'PROVIDER_WRITES=false',
      'DATABASE_MUTATIONS=false',
      'EXTERNAL_REPLY_WRITES=false',
      'SECRETS_PRINTED=false',
      'ENGAGEMENT_RUNTIME_ENABLED=true',
      'PROVIDER_SUBSCRIPTIONS_VERIFIED=true',
      'PERSISTENCE_READINESS_VERIFIED=true',
    ];

    for (const marker of markers) {
      expect(verifier).toContain(marker);
    }

    expect(verifier).not.toContain('gcloud run services update ');
    expect(verifier).not.toContain('gcloud run deploy ');
    expect(verifier).not.toContain('/subscriptions" -X POST');
    expect(verifier).not.toContain('/subscribed_apps" -X POST');
  });

  it('binds each gate to the exact authorized runtime and provider identity', () => {
    for (const workflow of workflows) {
      expect(workflow).toContain('WEBHOOK_SERVICE_NAME: toca-webhook-next-production');
      expect(workflow).toContain("META_APP_ID: '2281930145887404'");
      expect(workflow).toContain('META_APP_SECRET_ID: toca-meta-app-secret');
      expect(workflow).toContain('TOKEN_SECRET_ID: toca-meta-oauth-token');

      const runtimeBindings = workflow.match(
        /RUNTIME_IMAGE: \$\{\{ steps\.auth\.outputs\.runtime_image \}\}/g,
      );
      expect(runtimeBindings?.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('fails closed before any LIMITED mutation', () => {
    const gate = '      - name: Verify healthy Instagram webhook ingress before LIMITED mutation';

    for (const workflow of workflows) {
      expect(workflow.indexOf(gate)).toBeGreaterThan(-1);

      const calls = workflow.match(
        /bash scripts\/verify-instagram-engagement-webhook-ingress\.sh/g,
      );
      expect(calls?.length).toBe(2);
    }

    expectOrdered(direct, [gate, '      - name: Apply and verify production migrations']);
    expectOrdered(comment, [gate, '      - name: Prove dual-channel readiness without sending']);
    expectOrdered(faq, [gate, '      - name: Backup current shared FAQ and knowledge state']);
  });

  it('rechecks ingress after runtime readback and before publishing LIMITED PASS', () => {
    const finalGate =
      '      - name: Reverify healthy Instagram webhook ingress before publishing LIMITED state';

    expectOrdered(direct, [
      '      - name: Verify LIMITED runtime readback and unchanged scheduler',
      finalGate,
      '      - name: Publish LIMITED activation PASS',
    ]);
    expectOrdered(comment, [
      '      - name: Verify dual-channel LIMITED readback and unchanged scheduler',
      finalGate,
      '      - name: Publish Comment LIMITED promotion PASS',
    ]);
    expectOrdered(faq, [
      '      - name: Verify dual-channel LIMITED readback and scheduler immutability',
      finalGate,
      '      - name: Publish sanitized FAQ expansion PASS evidence',
    ]);
  });

  it('keeps webhook repair out of LIMITED promotion workflows', () => {
    for (const workflow of workflows) {
      expect(workflow).not.toContain('gcloud run services update "$WEBHOOK_SERVICE_NAME"');
      expect(workflow).not.toContain('gcloud run services update-traffic "$WEBHOOK_SERVICE_NAME"');
      expect(workflow).not.toContain('gcloud run deploy "$WEBHOOK_SERVICE_NAME"');
    }
  });
});
