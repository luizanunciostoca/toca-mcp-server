import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

const verifier = read('scripts/verify-instagram-engagement-webhook-ingress.sh');
const direct = read('.github/workflows/instagram-engagement-limited-activation.yml');
const comment = read(
  '.github/workflows/instagram-engagement-comment-limited-promotion.yml',
);
const faq = read(
  '.github/workflows/instagram-engagement-faq-expansion-limited-refresh.yml',
);
const ag01 = read(
  '.github/workflows/instagram-engagement-ag01-fallback-limited-activation.yml',
);

const promotions = [direct, comment, faq];

function expectOrdered(source: string, markers: readonly string[]): void {
  let prior = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    expect(index, marker).toBeGreaterThan(prior);
    prior = index;
  }
}

function countOccurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}

describe('Instagram engagement ingress promotion gate', () => {
  it('uses existing resources only and proves runtime, DB, provider and callback readiness', () => {
    for (const marker of [
      'run.googleapis.com/ingress',
      'run.googleapis.com/default-url-disabled',
      'run.googleapis.com/invoker-iam-disabled',
      'INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED',
      'META_WEBHOOK_ENABLED',
      'META_WEBHOOK_PERSISTENCE_ENABLED',
      'DATABASE_URL',
      '/healthz',
      '/readyz',
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
    ]) {
      expect(verifier).toContain(marker);
    }

    expect(verifier).not.toContain('gcloud run jobs deploy');
    expect(verifier).not.toContain('gcloud run jobs execute');
    expect(verifier).not.toContain('gcloud run services update ');
    expect(verifier).not.toContain('gcloud run deploy ');
    expect(verifier).not.toContain("method: 'POST'");
  });

  it('requires explicit bounded read authority in promotion controllers', () => {
    for (const workflow of [direct, comment, ag01]) {
      expect(workflow).toContain('SECRET_PAYLOAD_READS_AUTHORIZED=true');
      expect(workflow).toContain('PROVIDER_READS_AUTHORIZED=true');
      expect(workflow).toContain('PROVIDER_METHODS=GET_ONLY');
    }

    const faqGuard = read('scripts/instagram-faq-refresh-production-guard.sh');
    expect(faqGuard).toContain('SECRET_PAYLOAD_READS_AUTHORIZED=true');
    expect(faqGuard).toContain('PROVIDER_READS_AUTHORIZED=true');
    expect(faqGuard).toContain('PROVIDER_METHODS=GET_ONLY');
  });

  it('fails closed before mutation and revalidates after cutover', () => {
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

    const verifierCall =
      'bash scripts/verify-instagram-engagement-webhook-ingress.sh';
    for (const workflow of promotions) {
      expect(countOccurrences(workflow, verifierCall)).toBe(2);
    }

    expectOrdered(ag01, [
      '      - name: Verify healthy Instagram webhook ingress before AG-01 mutation',
      '      - name: Stage daemon candidate with grounded fallback at zero traffic',
      '      - name: Cut over exact candidate transactionally and verify LIMITED readback',
      '      - name: Reverify healthy Instagram webhook ingress after AG-01 cutover',
      '      - name: Publish sanitized activation evidence',
    ]);
    expect(countOccurrences(ag01, verifierCall)).toBe(2);
  });

  it('keeps callback repair out of all promotion workflows', () => {
    for (const workflow of [...promotions, ag01]) {
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
