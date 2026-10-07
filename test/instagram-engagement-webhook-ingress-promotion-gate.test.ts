import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const verifier = readFileSync('scripts/verify-instagram-engagement-webhook-ingress.sh', 'utf8');
const workflows = [
  {
    path: '.github/workflows/instagram-engagement-limited-activation.yml',
    firstMutation: '      - name: Apply and verify production migrations',
    finalReadback: '      - name: Verify LIMITED runtime readback and unchanged scheduler',
    publish: '      - name: Publish LIMITED activation PASS',
  },
  {
    path: '.github/workflows/instagram-engagement-comment-limited-promotion.yml',
    firstMutation: '      - name: Prove dual-channel readiness without sending',
    finalReadback: '      - name: Verify dual-channel LIMITED readback and unchanged scheduler',
    publish: '      - name: Publish Comment LIMITED promotion PASS',
  },
  {
    path: '.github/workflows/instagram-engagement-faq-expansion-limited-refresh.yml',
    firstMutation: '      - name: Backup current shared FAQ and knowledge state',
    finalReadback: '      - name: Verify dual-channel LIMITED readback and scheduler immutability',
    publish: '      - name: Publish sanitized FAQ expansion PASS evidence',
  },
].map((entry) => ({ ...entry, source: readFileSync(entry.path, 'utf8') }));

describe('Instagram engagement webhook ingress promotion gate', () => {
  it('proves only the DRS-safe public webhook serving boundary and challenge', () => {
    for (const marker of [
      'gcloud run services describe "$WEBHOOK_SERVICE_NAME"',
      'run.googleapis.com/default-url-disabled',
      'run.googleapis.com/invoker-iam-disabled',
      'roles/run.invoker',
      'allUsers',
      'TOCA_SERVICE_ROLE',
      'META_WEBHOOK_ENABLED',
      'META_WEBHOOK_PERSISTENCE_ENABLED',
      'INSTAGRAM_ENGAGEMENT_WRITES_ENABLED',
      'gcloud secrets versions access latest',
      'TOCA_META_WEBHOOK_VERIFY_TOKEN_V1',
      "method: 'GET'",
      'CALLBACK_CHALLENGE_PASS=true',
      'PROVIDER_WRITES=false',
      'DATABASE_MUTATIONS=false',
      'TRAFFIC_MUTATIONS=false',
      'RAW_SECRET_LOGGED=false',
    ]) {
      expect(verifier).toContain(marker);
    }

    expect(verifier).not.toContain('gcloud run services update ');
    expect(verifier).not.toContain('gcloud run deploy ');
    expect(verifier).not.toContain("method: 'POST'");
    expect(verifier).not.toContain('META_APP_SECRET_VALUE=' + '$' + 'APP_SECRET" echo');
  });

  it('fails closed before any LIMITED mutation when webhook ingress is unhealthy', () => {
    for (const workflow of workflows) {
      expect(workflow.source).toContain('WEBHOOK_SERVICE_NAME: toca-webhook-next-production');
      expect(workflow.source).toContain('META_APP_SECRET_ID: toca-meta-app-secret');

      const gate = workflow.source.indexOf(
        '      - name: Verify healthy Instagram webhook ingress before LIMITED mutation',
      );
      const mutation = workflow.source.indexOf(workflow.firstMutation);
      expect(gate, workflow.path).toBeGreaterThan(-1);
      expect(mutation, workflow.path).toBeGreaterThan(gate);

      const gateCalls = workflow.source.match(
        /bash scripts\/verify-instagram-engagement-webhook-ingress\.sh/g,
      );
      expect(gateCalls?.length, workflow.path).toBe(2);
    }
  });

  it('rechecks ingress after runtime readback and before publishing LIMITED PASS', () => {
    for (const workflow of workflows) {
      const readback = workflow.source.indexOf(workflow.finalReadback);
      const finalGate = workflow.source.indexOf(
        '      - name: Reverify healthy Instagram webhook ingress before publishing LIMITED state',
      );
      const publish = workflow.source.indexOf(workflow.publish);
      expect(readback, workflow.path).toBeGreaterThan(-1);
      expect(finalGate, workflow.path).toBeGreaterThan(readback);
      expect(publish, workflow.path).toBeGreaterThan(finalGate);
    }
  });

  it('keeps webhook repair out of the LIMITED promotion workflows', () => {
    for (const workflow of workflows) {
      expect(workflow.source).not.toContain(
        'gcloud run services update "$WEBHOOK_SERVICE_NAME"',
      );
      expect(workflow.source).not.toContain(
        'gcloud run services update-traffic "$WEBHOOK_SERVICE_NAME"',
      );
      expect(workflow.source).not.toContain(
        'gcloud run deploy "$WEBHOOK_SERVICE_NAME"',
      );
    }
  });
});
