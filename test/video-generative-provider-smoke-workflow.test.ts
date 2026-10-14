import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const smokeWorkflow = readFileSync('.github/workflows/video-generative-provider-smoke.yml', 'utf8');
const dispatchWorkflow = readFileSync(
  '.github/workflows/video-generative-provider-smoke-autodispatch.yml',
  'utf8',
);
const runner = readFileSync('src/video-generative-provider-smoke.ts', 'utf8');

describe('video generative provider smoke', () => {
  it('is hard-bound to the approved source/content/provider and remains publication closed', () => {
    expect(runner).toContain("'VID-TP-20260904-DUAS-PISTAS-GEN-001'");
    expect(runner).toContain("'TP-GEN-0001'");
    expect(runner).toContain("'e16d4bc9dba27eb60a826d9be6fd3dade2f1e2e48445e1155a421cf52ca7d85b'");
    expect(runner).toContain("routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO'");
    expect(runner).toContain("EXPECTED_PROVIDER = 'GOOGLE_VERTEX_VEO'");
    expect(runner).toContain("EXPECTED_PROVIDER_MODEL = 'veo-3.1-generate-001'");
    expect(runner).toContain("result.manifest.size !== '720x1280'");
    expect(runner).toContain('publicationAuthorized: false');
  });

  it('requires an owner-authored exact-main authorization issue before dispatch', () => {
    expect(dispatchWorkflow).toContain('issues:');
    expect(dispatchWorkflow).toContain('types: [opened]');
    expect(dispatchWorkflow).toContain('github.event.issue.user.login == github.repository_owner');
    expect(dispatchWorkflow).toContain(
      'require_key_value_once AUTHORIZED_CANDIDATE_SHA "$GITHUB_SHA"',
    );
    expect(dispatchWorkflow).toContain(
      'require_key_value_once VIDEO_CONTENT_ITEM_ID VID-TP-20260904-DUAS-PISTAS-GEN-001',
    );
    expect(dispatchWorkflow).toContain('PUBLICATION_AUTHORIZED=false');
  });

  it('fails closed on duplicate or conflicting authorization keys and requires bounded production proof authority', () => {
    for (const workflow of [dispatchWorkflow, smokeWorkflow]) {
      expect(workflow).toContain('read_key_once()');
      expect(workflow).toContain('require_key_value_once()');
      expect(workflow).toContain('test "$count" -eq 1');
      expect(workflow).toContain('require_key_value_once PROVIDER_CALL_AUTHORIZED true');
      expect(workflow).toContain(
        'require_key_value_once PRODUCTION_PROVIDER_PROOF_AUTHORIZED true',
      );
      expect(workflow).toContain('require_key_value_once PROVIDER GOOGLE_VERTEX_VEO');
      expect(workflow).toContain('require_key_value_once MODEL veo-3.1-generate-001');
      expect(workflow).toContain('require_key_value_once PROVIDER_OUTPUT_SECONDS 8');
      expect(workflow).toContain('require_key_value_once PROVIDER_SAMPLE_COUNT 1');
      expect(workflow).toContain('require_key_value_once PROVIDER_RESOLUTION 720p');
      expect(workflow).toContain('require_key_value_once PROVIDER_AUDIO_GENERATION false');
      expect(workflow).toContain(
        'require_key_value_once PRODUCTION_ARTIFACT_REGISTRY_WRITE_AUTHORIZED true',
      );
      expect(workflow).toContain(
        'require_key_value_once PRODUCTION_CLOUD_RUN_JOB_MUTATION_AUTHORIZED true',
      );
      expect(workflow).toContain(
        'require_key_value_once PRODUCTION_GCS_REVIEW_ARTIFACT_WRITE_AUTHORIZED true',
      );
      expect(workflow).toContain('require_key_value_once GOOGLE_DRIVE_READ_AUTHORIZED true');
      expect(workflow).toContain('require_key_value_once GOOGLE_SHEETS_READ_AUTHORIZED true');
      expect(workflow).toContain(
        'require_key_value_once GOOGLE_SHEETS_CANDIDATE_WRITE_AUTHORIZED true',
      );
      expect(workflow).toContain('require_key_value_once IAM_CREDENTIAL_SIGNING_AUTHORIZED true');
      expect(workflow).toContain(
        'require_key_value_once PRODUCTION_SERVICE_DEPLOYMENT_AUTHORIZED false',
      );
      expect(workflow).toContain(
        'require_key_value_once PRODUCTION_TRAFFIC_MUTATION_AUTHORIZED false',
      );
      expect(workflow).toContain(
        'require_key_value_once PRODUCTION_DATABASE_MUTATION_AUTHORIZED false',
      );
      expect(workflow).toContain('require_key_value_once PUBLICATION_AUTHORIZED false');
      expect(workflow).toContain('require_key_value_once SCHEDULING_AUTHORIZED false');
      expect(workflow).toContain('require_key_value_once MARKETING_READY_AUTHORIZED false');
      expect(workflow).toContain('require_key_value_once PAID_MEDIA_AUTHORIZED false');
      expect(workflow).toContain('FINANCIAL_CEILING="$(read_key_once FINANCIAL_CEILING)"');
      expect(workflow).toContain('^USD:([0-9]+([.][0-9]{1,2})?)$');
      expect(workflow).not.toContain('contains("AUTHORIZATION_STATE=ACTIVE")');
    }
    expect(dispatchWorkflow).toContain('require_key_value_once AUTO_DISPATCH_AUTHORIZED true');
    expect(dispatchWorkflow).toContain('require_control_value_once MAIN_STABILITY PASS');
    expect(dispatchWorkflow).toContain(
      'require_control_value_once EVALUATED_MAIN_SHA "$GITHUB_SHA"',
    );
    expect(dispatchWorkflow).toContain('require_control_value_once MERGE_RESERVATION NONE');
  });

  it('consumes the one-shot authorization before any production/provider mutation', () => {
    const consume = smokeWorkflow.indexOf(
      'Consume one-shot authorization before production or provider mutation',
    );
    const authenticate = smokeWorkflow.indexOf('Authenticate deployer to Google Cloud');
    const build = smokeWorkflow.indexOf('Build and push exact immutable smoke image');
    const execute = smokeWorkflow.indexOf('Execute exact scene-continuation provider smoke');
    expect(consume).toBeGreaterThanOrEqual(0);
    expect(authenticate).toBeGreaterThan(consume);
    expect(build).toBeGreaterThan(authenticate);
    expect(execute).toBeGreaterThan(build);
    expect(smokeWorkflow).toContain('AUTHORIZATION_STATE=CONSUMED_EXECUTION_STARTED');
    expect(smokeWorkflow).toContain('VIDEO_GENERATIVE_SMOKE=CONSUMED');
    expect(smokeWorkflow).toContain('-f state=closed');
    expect(smokeWorkflow).toContain('(.state == "closed")');
  });

  it('pins the production proof target, cost-shaping request and cleanup boundary', () => {
    expect(smokeWorkflow).toContain('test "$GCP_PROJECT_ID" = \'toca-mcp-production\'');
    expect(smokeWorkflow).toContain('test "$GCP_REGION" = \'southamerica-east1\'');
    expect(smokeWorkflow).toContain(
      'test "$GCP_RUNTIME_SERVICE_ACCOUNT" = \'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com\'',
    );
    expect(smokeWorkflow).toContain('test "$BUCKET" = \'toca-mcp-publication-assets\'');
    expect(smokeWorkflow).toContain('financialCeiling:$financialCeiling');
    expect(smokeWorkflow).toContain('outputSeconds:8');
    expect(smokeWorkflow).toContain('sampleCount:1');
    expect(smokeWorkflow).toContain('resolution:"720p"');
    expect(smokeWorkflow).toContain('generateAudio:false');
    expect(smokeWorkflow).toContain('productionProviderProofAuthorized:true');
    expect(smokeWorkflow).toContain('providerCallAuthorized:true');
    expect(smokeWorkflow).toContain('productionArtifactRegistryWriteAuthorized:true');
    expect(smokeWorkflow).toContain('productionCloudRunJobMutationAuthorized:true');
    expect(smokeWorkflow).toContain('productionGcsReviewArtifactWriteAuthorized:true');
    expect(smokeWorkflow).toContain('googleSheetsCandidateWriteAuthorized:true');
    expect(smokeWorkflow).toContain('productionServiceDeploymentAuthorized:false');
    expect(smokeWorkflow).toContain('productionTrafficMutationAuthorized:false');
    expect(smokeWorkflow).toContain('productionDatabaseMutationAuthorized:false');
    expect(smokeWorkflow).toContain('publicationAuthorized:false');
    expect(smokeWorkflow).toContain('schedulingAuthorized:false');
    expect(smokeWorkflow).toContain('marketingReadyAuthorized:false');
    expect(smokeWorkflow).toContain('paidMediaAuthorized:false');
    expect(smokeWorkflow).toContain('Verify ephemeral Cloud Run job cleanup');
    expect(smokeWorkflow).toContain('VIDEO_GENERATIVE_EPHEMERAL_JOB_ABSENT=PASS');
  });

  it('uses the canonical production bucket and service identity without long-lived provider secrets', () => {
    expect(smokeWorkflow).toContain(
      "vars.INSTAGRAM_PUBLICATION_ASSET_BUCKET || 'toca-mcp-publication-assets'",
    );
    expect(smokeWorkflow).toContain('VIDEO_SCENE_CONTINUATION_PROVIDER: GOOGLE_VERTEX_VEO');
    expect(smokeWorkflow).toContain('VIDEO_GOOGLE_AUTH_MODE: GCP_SERVICE_IDENTITY');
    expect(smokeWorkflow).toContain('VERTEX_VEO_LOCATION: us-central1');
    expect(smokeWorkflow).toContain('VERTEX_VEO_MODEL: veo-3.1-generate-001');
    expect(smokeWorkflow).not.toContain('--set-secrets');
    expect(smokeWorkflow).not.toContain('GCP_VIDEO_OPENAI_API_KEY_SECRET');
    expect(smokeWorkflow).not.toContain('GOOGLE_OAUTH_REFRESH_TOKEN_SECRET');
    expect(smokeWorkflow).not.toContain('gcloud run services describe');
    expect(smokeWorkflow).not.toContain('gcloud storage buckets list');
  });

  it('runs generation only under the production runtime identity and uploads exact review evidence', () => {
    expect(smokeWorkflow).toContain('environment: production');
    expect(smokeWorkflow).toContain('--service-account "$GCP_RUNTIME_SERVICE_ACCOUNT"');
    expect(smokeWorkflow).toContain('dist/src/video-generative-provider-smoke.js');
    expect(smokeWorkflow).toContain('VIDEO_GENERATIVE_PROVIDER_SMOKE_RESULT=');
    expect(smokeWorkflow).toContain('.provider == "GOOGLE_VERTEX_VEO"');
    expect(smokeWorkflow).toContain('.providerModel == "veo-3.1-generate-001"');
    expect(smokeWorkflow).toContain('.publicationEligible == false');
    expect(smokeWorkflow).toContain('.publicationAuthorized == false');
    expect(smokeWorkflow).toContain('test "$OBSERVED_SHA" = "$EXPECTED_SHA"');
    expect(smokeWorkflow).toContain(
      'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    );
  });

  it('captures sanitized retained Cloud Run evidence before cleanup when provider execution fails', () => {
    expect(smokeWorkflow).toContain('capture_failure_evidence()');
    expect(smokeWorkflow).toContain(
      'resource.type=\\"cloud_run_job\\" AND resource.labels.job_name=\\"${JOB_NAME}\\"',
    );
    expect(smokeWorkflow).toContain('/tmp/video-smoke-failure-logs.json');
    expect(smokeWorkflow).toContain('failure-diagnostic.json');
    expect(smokeWorkflow).toContain('.replace(/Bearer\\s+');
    expect(smokeWorkflow).toContain('.replace(/\\beyJ');
    expect(smokeWorkflow).toContain('rawPayloadPrinted: false');
    expect(smokeWorkflow).toContain('rawPayloadPersistedInArtifact: false');
    expect(smokeWorkflow).toContain('publicationAuthorized: false');
    expect(smokeWorkflow).toContain('if: always()');
    expect(smokeWorkflow).not.toContain('cat /tmp/video-smoke-failure-logs.json');
  });
});

function workflowShell(workflow: string, step: string): string {
  const section = workflow.split(`      - name: ${step}\n`)[1]?.split('\n      - name: ')[0];
  const shell = section?.split('        run: |\n')[1];
  if (!shell) throw new Error(`Missing executable workflow step: ${step}`);
  return shell
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
}

const authorizationFixture = {
  id: 10,
  number: 1,
  html_url: 'https://github.com/owner/repo/issues/1',
  title: 'PROVIDER AUTHORIZATION — Video Generative Smoke TP-GEN-0001',
  user: { id: 20, login: 'owner' },
  state: 'open',
  updated_at: '2026-10-14T00:00:00Z',
  body: 'AUTHORIZED_CANDIDATE_SHA=fixture-sha\nAUTHORIZATION_STATE=ACTIVE\nVIDEO_GENERATIVE_SMOKE=AUTHORIZED\nPROVIDER_CALL_AUTHORIZED=true\nFINANCIAL_CEILING=USD:10.00',
};

function consumeFixture(live = authorizationFixture, readback = { ...live, state: 'closed' }) {
  const directory = mkdtempSync(join(tmpdir(), 'toca-video-authority-'));
  try {
    writeFileSync(join(directory, 'video-auth.json'), JSON.stringify(authorizationFixture));
    const shell = workflowShell(
      smokeWorkflow,
      'Consume one-shot authorization before production or provider mutation',
    ).replaceAll('/tmp/video-auth', join(directory, 'video-auth'));
    const mock = `
      gh() {
        case "$*" in
          *'/branches/main'*) printf '%s' "$GITHUB_SHA" ;;
          *'--method PATCH'*) printf '%s' "$*" > "$PATCH_ARGS"; printf '%s' "$AFTER_JSON" ;;
          *'/comments'*) printf '%s' "$*" > "$RECEIPT_ARGS"; printf '{}' ;;
          *'/issues/640'*) printf 'MAIN_STABILITY=PASS\\nEVALUATED_MAIN_SHA=fixture-sha\\nMERGE_RESERVATION=NONE' ;;
          *'/issues/1'*) if [ -f "$PATCH_ARGS" ]; then printf '%s' "$AFTER_JSON"; else printf '%s' "$LIVE_AUTH_JSON"; fi ;;
          *) echo 'unexpected mock gh operation' >&2; return 91 ;;
        esac
      }
    `;
    const result = spawnSync('bash', ['-c', `${mock}\n${shell}`], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        GITHUB_SHA: 'fixture-sha',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_REPOSITORY_OWNER: 'owner',
        GITHUB_RUN_ID: 'fixture-run',
        AUTHORIZATION_ISSUE_NUMBER: '1',
        VIDEO_PROVIDER_FINANCIAL_CEILING: 'USD:10.00',
        LIVE_AUTH_JSON: JSON.stringify(live),
        AFTER_JSON: JSON.stringify(readback),
        PATCH_ARGS: join(directory, 'patch'),
        RECEIPT_ARGS: join(directory, 'receipt'),
      },
    });
    return {
      ...result,
      patch: existsSync(join(directory, 'patch'))
        ? readFileSync(join(directory, 'patch'), 'utf8')
        : '',
      receipt: existsSync(join(directory, 'receipt'))
        ? readFileSync(join(directory, 'receipt'), 'utf8')
        : '',
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('video provider executable fail-closed regressions', () => {
  for (const [name, workflow] of [
    ['dispatch', dispatchWorkflow],
    ['execution', smokeWorkflow],
  ] as const) {
    it.each([
      ['valid', 'PROVIDER_CALL_AUTHORIZED=true', true],
      ['missing', 'OTHER=true', false],
      ['empty', 'PROVIDER_CALL_AUTHORIZED=', false],
      ['revoked', 'PROVIDER_CALL_AUTHORIZED=false', false],
      ['equal duplicate', 'PROVIDER_CALL_AUTHORIZED=true\nPROVIDER_CALL_AUTHORIZED=true', false],
      [
        'conflicting duplicate',
        'PROVIDER_CALL_AUTHORIZED=true\nPROVIDER_CALL_AUTHORIZED=false',
        false,
      ],
      [
        'trailing empty duplicate',
        'PROVIDER_CALL_AUTHORIZED=true\nPROVIDER_CALL_AUTHORIZED=',
        false,
      ],
      [
        'leading empty duplicate',
        'PROVIDER_CALL_AUTHORIZED=\nPROVIDER_CALL_AUTHORIZED=true',
        false,
      ],
    ])(
      `${name}: %s authorization cannot bypass command-substitution checks`,
      (_case, body, accepted) => {
        const block = workflow.match(
          / {10}read_key_once\(\) \{[\s\S]*?(?= {10}require_key_value_once AUTHORIZED_CANDIDATE_SHA)/,
        )?.[0];
        expect(block).toBeTruthy();
        const result = spawnSync(
          'bash',
          [
            '-c',
            `set -euo pipefail\n${block}\nif require_key_value_once PROVIDER_CALL_AUTHORIZED true; then echo AUTHORIZED; else exit 1; fi`,
          ],
          {
            encoding: 'utf8',
            timeout: 5000,
            env: { ...process.env, BODY: String(body) },
          },
        );
        expect(result.status === 0, result.stderr).toBe(accepted);
        expect(result.stdout.includes('AUTHORIZED')).toBe(accepted);
      },
    );
  }

  it('consumes only issue state, independently reads back unchanged authority, and records a receipt', () => {
    const result = consumeFixture();
    expect(result.status, result.stderr).toBe(0);
    expect(result.patch).toContain('-f state=closed');
    expect(result.patch).not.toContain('-f body=');
    expect(result.receipt).toContain('AUTHORIZATION_STATE=CONSUMED_EXECUTION_STARTED');
    expect(result.stdout).toContain('VIDEO_GENERATIVE_PROVIDER_AUTHORIZATION=CONSUMED');
  });

  const authorityChanges = [
    {
      name: 'provider revocation',
      change: {
        body: authorizationFixture.body.replace(
          'PROVIDER_CALL_AUTHORIZED=true',
          'PROVIDER_CALL_AUTHORIZED=false',
        ),
      },
    },
    {
      name: 'lower financial ceiling',
      change: { body: authorizationFixture.body.replace('USD:10.00', 'USD:0.01') },
    },
    {
      name: 'duplicate key',
      change: { body: `${authorizationFixture.body}\nPROVIDER_CALL_AUTHORIZED=` },
    },
    { name: 'author replacement', change: { user: { id: 99, login: 'other' } } },
    { name: 'retitled authority', change: { title: 'different authority' } },
    { name: 'different issue', change: { id: 99 } },
  ];
  it.each(authorityChanges)('rejects $name before any consumption write', ({ change }) => {
    const result = consumeFixture({ ...authorizationFixture, ...change });
    expect(result.status).not.toBe(0);
    expect(result.patch).toBe('');
    expect(result.receipt).toBe('');
  });
  it.each(authorityChanges)('preserves and rejects $name racing with closure', ({ change }) => {
    const result = consumeFixture(authorizationFixture, {
      ...authorizationFixture,
      ...change,
      state: 'closed',
    });
    expect(result.status).not.toBe(0);
    expect(result.patch).not.toContain('-f body=');
    expect(result.receipt).toBe('');
    expect(result.stdout).not.toContain('VIDEO_GENERATIVE_PROVIDER_AUTHORIZATION=CONSUMED');
  });
  it('rejects timestamp drift and reopening', () => {
    expect(
      consumeFixture({ ...authorizationFixture, updated_at: '2026-10-14T00:00:01Z' }).patch,
    ).toBe('');
    expect(consumeFixture(authorizationFixture, authorizationFixture).status).not.toBe(0);
  });

  it.each([
    ['absent', '[]', 0, true],
    ['present', '[{"metadata":{"name":"fixture-job"}}]', 0, false],
    ['fully qualified present', '[{"name":"projects/p/locations/r/jobs/fixture-job"}]', 0, false],
    ['permission failure', '[]', 1, false],
    ['malformed result', '{}', 0, false],
    ['missing identity', '[{}]', 0, false],
  ])(
    'cleanup: %s must have authoritative absence readback',
    (_case, output, exitCode, accepted) => {
      const shell = workflowShell(smokeWorkflow, 'Verify ephemeral Cloud Run job cleanup');
      const result = spawnSync(
        'bash',
        ['-c', `gcloud() { printf '%s' "$MOCK_OUTPUT"; return "$MOCK_EXIT"; }\n${shell}`],
        {
          encoding: 'utf8',
          timeout: 5000,
          env: {
            ...process.env,
            JOB_NAME: 'fixture-job',
            GCP_PROJECT_ID: 'toca-mcp-production',
            GCP_REGION: 'southamerica-east1',
            MOCK_OUTPUT: String(output),
            MOCK_EXIT: String(exitCode),
          },
        },
      );
      expect(result.status === 0, result.stderr).toBe(accepted);
      expect(result.stdout.includes('VIDEO_GENERATIVE_EPHEMERAL_JOB_ABSENT=PASS')).toBe(accepted);
    },
  );
  it('does not certify job absence when no job was created', () => {
    const shell = workflowShell(smokeWorkflow, 'Verify ephemeral Cloud Run job cleanup');
    const result = spawnSync(
      'bash',
      ['-c', `gcloud() { echo UNEXPECTED_PROVIDER_READ; return 91; }\n${shell}`],
      {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, JOB_NAME: '' },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('ABSENT=PASS');
    expect(result.stdout).not.toContain('UNEXPECTED_PROVIDER_READ');
    expect(result.stdout).toContain('VIDEO_GENERATIVE_EPHEMERAL_JOB_ABSENT=NOT_CREATED');
  });
});
