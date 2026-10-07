import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const verifier = readFileSync(
  'scripts/verify-instagram-engagement-webhook-ingress.sh',
  'utf8',
);
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
const ag01 = readFileSync(
  '.github/workflows/instagram-engagement-ag01-fallback-limited-activation.yml',
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
  it('proves complete ingress readiness using only existing resources', () => {
    const markers = [
      'run.googleapis.com/ingress',
      'run.googleapis.com/default-url-disabled',
      'run.googleapis.com/invoker-iam-disabled',
      'INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED',
      'META_WEBHOOK_ENABLED',
      'META_WEBHOOK_PERSISTENCE_ENABLED',
      'DATABASE_URL',
      'curl --silent --show-error --connect-timeout 5 --max-time 20',
      'gcloud secrets versions access latest',
      'TOCA_META_WEBHOOK_VERIFY_TOKEN_V1',
      '/subscriptions',
      '/subscribed_apps',
      'APP_CALLBACK_URL_MATCH=true',
      'APP_COMMENTS_FIELD_PRESENT=true',
      'APP_MESSAGES_FIELD_PRESENT=true',
      'PAGE_APP_SUBSCRIPTION_PRESENT=true',
      'PAGE_MESSAGES_FIELD_PRESENT=true',
      'CALLBACK_CHALLENGE_PASS=true',
      'PROVIDER_METHODS=GET_ONLY',
      'NEW_PAID_RESOURCE_ALLOCATION=false',
      'DATABASE_MUTATIONS=false',
      'PERSISTENT_SERVICE_MUTATIONS=false',
    ];

    for (const marker of markers) {
      expect(verifier).toContain(marker);
    }

    expect(verifier).not.toContain('gcloud run jobs deploy');
    expect(verifier).not.toContain('gcloud run jobs execute');
    expect(verifier).not.toContain('gcloud run services update ');
    expect(verifier).not.toContain('gcloud run deploy ');
    expect(verifier).not.toContain("method: 'POST'");
  });

  it('binds every LIMITED gate to the shared callback mutex', () => {
    for (const workflow of [...workflows, ag01]) {
      expect(workflow).toContain(
        'group: instagram-engagement-webhook-callback-control',
      );
      expect(workflow).toContain('cancel-in-progress: false');
    }
  });

  it('binds Direct Comment and FAQ gates to the exact authorized runtime', () => {
    for (const workflow of workflows) {
      expect(workflow).toContain(
        'WEBHOOK_SERVICE_NAME: toca-webhook-next-production',
      );
      expect(workflow).toContain("META_APP_ID: '2281930145887404'");
      expect(workflow).toContain('META_APP_SECRET_ID: toca-meta-app-secret');
      expect(workflow).toContain('TOKEN_SECRET_ID: toca-meta-oauth-token');

      const runtimeBindings = workflow.match(
        /RUNTIME_IMAGE: ${{ steps.auth.outputs.runtime_image }}/g,
      );
      expect(runtimeBindings?.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('fails closed before mutation and rechecks before publishing PASS', () => {
    const firstGate =
      '      - name: Verify healthy Instagram webhook ingress before LIMITED mutation';
    const finalGate =
      '      - name: Reverify healthy Instagram webhook ingress before publishing LIMITED state';

    expectOrdered(direct, [
      firstGate,
      '      - name: Apply and verify production migrations',
      '      - name: Verify LIMITED runtime readback and unchanged scheduler',
      finalGate,
      '      - name: Publish LIMITED activation PASS',
    ]);
    expectOrdered(comment, [
      firstGate,
      '      - name: Prove dual-channel readiness without sending',
      '      - name: Verify dual-channel LIMITED readback and unchanged scheduler',
      finalGate,
      '      - name: Publish Comment LIMITED promotion PASS',
    ]);
    expectOrdered(faq, [
      firstGate,
      '      - name: Backup current shared FAQ and knowledge state',
      '      - name: Verify dual-channel LIMITED readback and scheduler immutability',
      finalGate,
      '      - name: Publish sanitized FAQ expansion PASS evidence',
    ]);

    for (const workflow of workflows) {
      const calls = workflow.match(
        /bash scripts/verify-instagram-engagement-webhook-ingress.sh/g,
      );
      expect(calls?.length).toBe(2);
    }
  });

  it('keeps callback repair out of promotion workflows', () => {
    for (const workflow of workflows) {
      expect(workflow).not.toContain(
        'gcloud run services update "$WEBHOOK_SERVICE_NAME"',
      );
      expect(workflow).not.toContain(
        'gcloud run services update-traffic "$WEBHOOK_SERVICE_NAME"',
      );
      expect(workflow).not.toContain(
        'gcloud run deploy "$WEBHOOK_SERVICE_NAME"',
      );
    }
  });
});
