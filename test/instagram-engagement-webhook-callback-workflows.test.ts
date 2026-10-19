import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

const readonlyWorkflow = read(
  '.github/workflows/instagram-engagement-webhook-callback-readonly.yml',
);
const restoreWorkflow = read('.github/workflows/instagram-engagement-webhook-callback-restore.yml');
const verifier = read('scripts/verify-instagram-engagement-webhook-ingress.sh');
const deploy = read('.github/workflows/deploy-gcp.yml');

const issueScoped = [
  [
    '.github/workflows/instagram-engagement-webhook-callback-readonly.yml',
    'PRODUCTION AUTHORIZATION — Instagram webhook callback READONLY AUTO',
    'instagram-webhook-callback-readonly',
  ],
  [
    '.github/workflows/instagram-engagement-webhook-callback-restore.yml',
    'PRODUCTION AUTHORIZATION — Instagram webhook callback restore AUTO',
    'instagram-webhook-callback-restore',
  ],
  [
    '.github/workflows/instagram-engagement-limited-activation.yml',
    'PRODUCTION AUTHORIZATION — Instagram engagement LIMITED activation AUTO',
    'instagram-limited-activation',
  ],
  [
    '.github/workflows/instagram-engagement-comment-limited-promotion.yml',
    'PRODUCTION AUTHORIZATION — Instagram engagement COMMENT LIMITED promotion AUTO',
    'instagram-comment-limited-promotion',
  ],
  [
    '.github/workflows/instagram-engagement-faq-expansion-limited-refresh.yml',
    'PRODUCTION AUTHORIZATION — Instagram FAQ expansion LIMITED refresh AUTO',
    'instagram-faq-limited-refresh',
  ],
  [
    '.github/workflows/instagram-engagement-ag01-fallback-limited-activation.yml',
    'PRODUCTION AUTHORIZATION — Instagram AG-01 grounded fallback LIMITED activation AUTO',
    'instagram-ag01-limited-activation',
  ],
  [
    '.github/workflows/instagram-engagement-final-shadow-proof.yml',
    'PRODUCTION AUTHORIZATION — Instagram final shadow proof AUTO',
    'instagram-final-shadow-proof',
  ],
  [
    '.github/workflows/instagram-engagement-corrected-shadow-proof-retry.yml',
    'PRODUCTION AUTHORIZATION — Instagram corrected shadow proof retry AUTO',
    'instagram-corrected-shadow-proof-retry',
  ],
  [
    '.github/workflows/instagram-engagement-corrected-runtime-shadow.yml',
    'PRODUCTION AUTHORIZATION — Instagram corrected runtime shadow AUTO',
    'instagram-corrected-runtime-shadow',
  ],
] as const;

const dispatchWriters = [
  '.github/workflows/instagram-engagement-shadow-production.yml',
  '.github/workflows/instagram-engagement-shadow-proof-recovery.yml',
  '.github/workflows/instagram-engagement-shadow-candidate-recovery.yml',
  '.github/workflows/instagram-engagement-shadow-unique-candidate-recovery.yml',
].map(read);

function expectOrdered(source: string, markers: readonly string[]): void {
  let prior = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    expect(index, marker).toBeGreaterThan(prior);
    prior = index;
  }
}

describe('Instagram webhook callback governance', () => {
  it('executes fail-closed authorization for optional bounded runtime diagnostics', () => {
    const start = readonlyWorkflow.indexOf('          required=(');
    const end = readonlyWorkflow.indexOf('          CONTROL_BODY=', start);
    const authorization = readonlyWorkflow.slice(start, end);
    const base = [
      'AUTHORIZED_CANDIDATE_SHA=candidate',
      'AUTHORIZATION_STATE=ACTIVE',
      'INSTAGRAM_ENGAGEMENT_WEBHOOK_CALLBACK_READONLY=AUTHORIZED',
      'READ_ONLY=true',
      'SERVICE_MUTATIONS_AUTHORIZED=false',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'PROVIDER_CALLS_AUTHORIZED=false',
      'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
    ];
    const optin = [
      'INCLUDE_SANITIZED_RUNTIME_LOGS=true',
      'RUNTIME_LOG_WINDOW=LAST_2_HOURS',
      'RUNTIME_LOG_LIMIT=200',
      'PUBLIC_HEALTH_PROBES=GET_HEALTH_AND_READY_ONLY',
      'IAM_MUTATIONS_AUTHORIZED=false',
    ];
    const check = (markers: string[]) =>
      spawnSync(
        'bash',
        [
          '-c',
          'set -euo pipefail\n' + authorization + '\nprintf "%s" "$INCLUDE_RUNTIME_DIAGNOSTICS"',
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, GITHUB_SHA: 'candidate', BODY: markers.join('\n') },
        },
      );
    expect(check(base)).toMatchObject({ status: 0, stdout: 'false' });
    expect(check([...base, ...optin])).toMatchObject({ status: 0, stdout: 'true' });
    for (const markers of [
      [...base, 'INCLUDE_SANITIZED_RUNTIME_LOGS=true'],
      [...base, ...optin, 'INCLUDE_SANITIZED_RUNTIME_LOGS=false'],
      [...base, ...optin, 'AUTHORIZATION_STATE=CONSUMED'],
      [
        ...base,
        ...optin.filter((value) => value !== 'RUNTIME_LOG_LIMIT=200'),
        'RUNTIME_LOG_LIMIT=1000',
      ],
      [...base, ...optin, 'IAM_MUTATIONS_AUTHORIZED=true'],
    ])
      expect(check(markers).status).not.toBe(0);
  });

  it('bounds current-revision log reads and probes with the existing identity and mutex', () => {
    expect(readonlyWorkflow).toContain(
      "if: steps.auth.outputs.include_runtime_diagnostics == 'true'",
    );
    expect(readonlyWorkflow).toContain(
      'toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com',
    );
    expect(readonlyWorkflow).toContain('--limit=200 --order=desc --format=json');
    expect(readonlyWorkflow).toContain('timestamp>=');
    expect(readonlyWorkflow).toContain('timestamp<=');
    expect(readonlyWorkflow).toContain('--connect-timeout 5 --max-time 15');
    expect(readonlyWorkflow).toContain('"$WEBHOOK_URL/health"');
    expect(readonlyWorkflow).toContain('"$WEBHOOK_URL/ready"');
    expect(readonlyWorkflow).toContain('RAW_LOG_PAYLOAD_PUBLISHED=false');
    for (const forbidden of [
      '--impersonate-service-account',
      'add-iam-policy-binding',
      'gcloud run deploy',
      'gcloud secrets versions access',
      '--location-trusted',
      '--retry',
    ]) {
      expect(readonlyWorkflow).not.toContain(forbidden);
    }
  });

  it('shares the callback mutex only for matching issue-triggered controllers', () => {
    for (const [path, titlePrefix, fallback] of issueScoped) {
      const workflow = read(path);
      expect(workflow).toContain(
        `github.event.issue.user.login == github.repository_owner && startsWith(github.event.issue.title, '${titlePrefix}') && 'instagram-engagement-webhook-callback-control'`,
      );
      expect(workflow).toContain(`format('${fallback}-{0}', github.run_id)`);
      expect(workflow).toContain('cancel-in-progress: false');
      expect(workflow).not.toContain('group: instagram-engagement-webhook-callback-control\n');
    }
  });

  it('keeps explicit callback writers and production deploy serialized', () => {
    for (const workflow of dispatchWriters) {
      expect(workflow).toContain('group: instagram-engagement-webhook-callback-control');
      expect(workflow).toContain('cancel-in-progress: false');
    }

    expect(deploy).toContain(
      "inputs.environment == 'production' && 'instagram-engagement-webhook-callback-control'",
    );
    expect(deploy).toContain("format('deploy-gcp-next-{0}', inputs.environment)");
    expect(deploy).toContain('cancel-in-progress: false');
  });

  it('classifies restricted ingress as blocked and never emits false readback PASS', () => {
    for (const marker of [
      'run.googleapis.com/ingress',
      'BLOCKED_INGRESS_RESTRICTED',
      'BLOCKED_DEFAULT_URL_DISABLED',
      'BLOCKED_INVOKER_IAM_CHECK_ENABLED',
      'STATUS=FAIL',
      'if [[ "$READBACK_OUTCOME" == success ]]; then STATUS=PASS; fi',
    ]) {
      expect(readonlyWorkflow).toContain(marker);
    }

    expect(readonlyWorkflow).not.toContain('gcloud run services update "$WEBHOOK_SERVICE_NAME"');
  });

  it('consumes authorization before mutation or verified no-op and scopes the repair tightly', () => {
    for (const marker of [
      'MUTATION_SCOPE=INGRESS_DEFAULT_URL_INVOKER_IAM_CHECK_ONLY',
      'SERVICE_MUTATION_AUTHORIZED=true',
      'TRAFFIC_MUTATION_AUTHORIZED=false',
      'IMAGE_MUTATION_AUTHORIZED=false',
      'REVISION_DEPLOY_AUTHORIZED=false',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'SECRET_PAYLOAD_READS_AUTHORIZED=true',
      'TOKEN_SECRET_ID: toca-meta-oauth-token',
      'PROVIDER_READS_AUTHORIZED=true',
      'PROVIDER_METHODS=GET_ONLY',
      'PROVIDER_WRITES_AUTHORIZED=false',
      'NEW_PAID_RESOURCES_AUTHORIZED=false',
      'GENERAL_AUTONOMY_AUTHORIZED=false',
      'CALLBACK_CLASSIFICATION=(PUBLIC_CALLBACK_READY|BLOCKED_',
      'mutation_required=$MUTATION_REQUIRED',
      'MUTATION_REQUIRED: ${{ steps.prestate.outputs.mutation_required }}',
      'WEBHOOK_CALLBACK_RESTORE_MUTATION=SKIPPED_ALREADY_READY',
      'SERVICE_MUTATION=$SERVICE_MUTATION',
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

  it('treats already-ready callback posture as a verified zero-mutation success path', () => {
    expect(restoreWorkflow).toContain('MUTATION_REQUIRED=false');
    expect(restoreWorkflow).toContain('if [[ "$MUTATION_REQUIRED" == false ]]');
    expect(restoreWorkflow).toContain('echo \'mutation_completed=false\' >> "$GITHUB_OUTPUT"');
    expectOrdered(restoreWorkflow, [
      '      - name: Capture exact service-level prestate',
      '      - name: Consume single-use authorization before mutation',
      '      - name: Restore only the required DRS-safe callback surface',
      '      - name: Read back runtime, DB schema, challenge and Meta subscriptions',
      '      - name: Publish successful repair evidence',
    ]);
  });

  it('rolls back failure or cancellation and makes attempted authorization non-reusable', () => {
    expect(restoreWorkflow).toContain(
      "if: (failure() || cancelled()) && env.MUTATION_ATTEMPTED == 'true'",
    );
    expect(restoreWorkflow).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
    expect(restoreWorkflow).toContain(
      "if: always() && env.AUTHORIZATION_CONSUMED == 'true' && (failure() || cancelled())",
    );
    expect(restoreWorkflow).toContain('echo \'AUTHORIZATION_CONSUMED=true\' >> "$GITHUB_ENV"');
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
