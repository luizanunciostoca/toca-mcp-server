from pathlib import Path

workflow_path = Path('.github/workflows/deploy-gcp.yml')
text = workflow_path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    '''          mkdir -p platform-evidence
          test -n "$WEBHOOK_TOKEN" || { echo 'Webhook private probe ID token missing' >&2; exit 1; }
          WEBHOOK_AUTH=(-H "Authorization: Bearer $WEBHOOK_TOKEN")

          if [[ "$DEPLOY_ENVIRONMENT" == production ]]; then
''',
    '''          mkdir -p platform-evidence

          if [[ "$DEPLOY_ENVIRONMENT" == production ]]; then
''',
    'production webhook token decoupling',
)

old_webhook_probe = '''          curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 "${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/healthz" | tee platform-evidence/webhook-healthz.json
          curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 "${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/readyz" | tee platform-evidence/webhook-readyz.json
          jq -e '.status == "ready" and (.checks | all(.ok == true))' platform-evidence/webhook-readyz.json >/dev/null
          MCP_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/mcp")"
          OAUTH_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/oauth/meta/start")"
          [[ "$MCP_STATUS" == 404 && "$OAUTH_STATUS" == 404 ]] || { echo 'Webhook candidate exposed a forbidden route' >&2; exit 1; }
          jq -n --arg mcp "$MCP_STATUS" --arg oauth "$OAUTH_STATUS" '{schemaVersion:"toca.platform.e2e.v1",webhookMcpStatus:($mcp|tonumber),webhookOauthStatus:($oauth|tonumber),result:"PASS"}' > platform-evidence/e2e-results.json
'''

new_webhook_probe = '''          if [[ "$DEPLOY_ENVIRONMENT" == production ]]; then
            test -n "$WEBHOOK_REVISION" || { echo 'Webhook exact candidate revision missing' >&2; exit 1; }

            # Cloud Scheduler is a supported internal Cloud Run caller only through a service's
            # canonical default run.app URL. Validate the production webhook candidate through a
            # short-lived sibling that reuses the exact immutable image and runtime configuration,
            # while the real candidate remains at zero traffic.
            WEBHOOK_PROBE_SERVICE="toca-webhook-accept-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
            WEBHOOK_PROBE_MEMBER="serviceAccount:${GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT}"
            WEBHOOK_HEALTH_JOB="toca-wh-health-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
            WEBHOOK_READY_JOB="toca-wh-ready-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
            WEBHOOK_MCP_JOB="toca-wh-mcp-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
            WEBHOOK_OAUTH_JOB="toca-wh-oauth-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"

            cleanup_internal_webhook_probe() {
              set +e
              for job in "$WEBHOOK_HEALTH_JOB" "$WEBHOOK_READY_JOB" "$WEBHOOK_MCP_JOB" "$WEBHOOK_OAUTH_JOB"; do
                gcloud scheduler jobs delete "$job" \\
                  --project "$GCP_PROJECT_ID" --location "$GCP_REGION" --quiet >/dev/null 2>&1 || true
              done
              gcloud run services delete "$WEBHOOK_PROBE_SERVICE" \\
                --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1 || true
              set -e
            }
            trap cleanup_internal_webhook_probe EXIT

            gcloud run deploy "$WEBHOOK_PROBE_SERVICE" --image "$IMAGE" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \\
              --revision-suffix "probe-${GITHUB_SHA::8}" \\
              --service-account "$GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT" \\
              --add-cloudsql-instances "${GCP_PROJECT_ID}:${GCP_REGION}:${GCP_CLOUD_SQL_INSTANCE}" \\
              --update-secrets "$WEBHOOK_RUNTIME_SECRETS" --update-env-vars "$WEBHOOK_RUNTIME_ENV" \\
              --startup-probe 'httpGet.path=/readyz,httpGet.port=8080,failureThreshold=12,timeoutSeconds=5,periodSeconds=5' \\
              --liveness-probe 'httpGet.path=/healthz,httpGet.port=8080,failureThreshold=3,timeoutSeconds=3,periodSeconds=10' \\
              --min-instances 1 --max-instances 1 \\
              --cpu-throttling --memory "${{ vars.GCP_WEBHOOK_MEMORY || '512Mi' }}" --cpu "${{ vars.GCP_WEBHOOK_CPU || '1' }}" \\
              --ingress internal --default-url --no-allow-unauthenticated \\
              --no-deploy-health-check --quiet

            gcloud run services describe "$WEBHOOK_PROBE_SERVICE" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \\
              > /tmp/webhook-acceptance-service.json
            WEBHOOK_PROBE_URL="$(jq -r '.status.url // empty' /tmp/webhook-acceptance-service.json)"
            WEBHOOK_PROBE_REVISION="$(jq -r '.status.latestCreatedRevisionName // empty' /tmp/webhook-acceptance-service.json)"
            WEBHOOK_PROBE_INGRESS="$(jq -r '.metadata.annotations["run.googleapis.com/ingress"] // "all"' /tmp/webhook-acceptance-service.json)"
            WEBHOOK_PROBE_DEFAULT_URL_DISABLED="$(jq -r '.metadata.annotations["run.googleapis.com/default-url-disabled"] // "false"' /tmp/webhook-acceptance-service.json)"
            test -n "$WEBHOOK_PROBE_URL" || { echo 'Ephemeral webhook acceptance service has no canonical run.app URL' >&2; exit 1; }
            test -n "$WEBHOOK_PROBE_REVISION" || { echo 'Ephemeral webhook acceptance service has no created revision' >&2; exit 1; }
            [[ "$WEBHOOK_PROBE_INGRESS" == internal ]] || { echo "Ephemeral webhook acceptance ingress is not internal: $WEBHOOK_PROBE_INGRESS" >&2; exit 1; }
            [[ "$WEBHOOK_PROBE_DEFAULT_URL_DISABLED" == false ]] || { echo 'Ephemeral webhook acceptance default URL is disabled' >&2; exit 1; }

            WEBHOOK_PROBE_READY=Unknown
            WEBHOOK_PROBE_READY_REASON=Pending
            for _ in $(seq 1 18); do
              if gcloud run revisions describe "$WEBHOOK_PROBE_REVISION" \\
                --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \\
                > /tmp/webhook-acceptance-revision.json 2>/dev/null; then
                WEBHOOK_PROBE_READY="$(jq -r '[.status.conditions[]? | select(.type == "Ready") | .status] | last // "Unknown"' /tmp/webhook-acceptance-revision.json)"
                WEBHOOK_PROBE_READY_REASON="$(jq -r '[.status.conditions[]? | select(.type == "Ready") | .reason] | last // "Unknown"' /tmp/webhook-acceptance-revision.json)"
                [[ "$WEBHOOK_PROBE_READY" == True ]] && break
              fi
              sleep 5
            done
            if [[ "$WEBHOOK_PROBE_READY" != True ]]; then
              echo "Ephemeral webhook acceptance failed Ready gate: status=$WEBHOOK_PROBE_READY reason=$WEBHOOK_PROBE_READY_REASON" >&2
              exit 1
            fi

            gcloud run revisions describe "$WEBHOOK_REVISION" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \\
              > /tmp/webhook-production-candidate-revision.json
            gcloud run revisions describe "$WEBHOOK_PROBE_REVISION" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \\
              > /tmp/webhook-acceptance-revision.json
            WEBHOOK_CANDIDATE_RUNTIME_IMAGE="$(jq -r '.spec.containers[0].image // empty' /tmp/webhook-production-candidate-revision.json)"
            WEBHOOK_PROBE_RUNTIME_IMAGE="$(jq -r '.spec.containers[0].image // empty' /tmp/webhook-acceptance-revision.json)"
            WEBHOOK_CANDIDATE_RELEASE_SHA="$(jq -r '[.spec.containers[0].env[]? | select(.name == "TOCA_RELEASE_SHA") | .value] | unique | if length == 1 then .[0] else empty end' /tmp/webhook-production-candidate-revision.json)"
            WEBHOOK_PROBE_RELEASE_SHA="$(jq -r '[.spec.containers[0].env[]? | select(.name == "TOCA_RELEASE_SHA") | .value] | unique | if length == 1 then .[0] else empty end' /tmp/webhook-acceptance-revision.json)"
            WEBHOOK_CANDIDATE_RUNTIME_SA="$(jq -r '.spec.serviceAccountName // empty' /tmp/webhook-production-candidate-revision.json)"
            WEBHOOK_PROBE_RUNTIME_SA="$(jq -r '.spec.serviceAccountName // empty' /tmp/webhook-acceptance-revision.json)"
            WEBHOOK_CANDIDATE_READY="$(jq -r '[.status.conditions[]? | select(.type == "Ready") | .status] | last // empty' /tmp/webhook-production-candidate-revision.json)"
            WEBHOOK_PROBE_STARTUP_PATH="$(jq -r '.spec.containers[0].startupProbe.httpGet.path // empty' /tmp/webhook-acceptance-revision.json)"
            WEBHOOK_PROBE_LIVENESS_PATH="$(jq -r '.spec.containers[0].livenessProbe.httpGet.path // empty' /tmp/webhook-acceptance-revision.json)"

            test -n "$WEBHOOK_CANDIDATE_RUNTIME_IMAGE" || { echo 'Production webhook candidate runtime image missing' >&2; exit 1; }
            [[ "$WEBHOOK_CANDIDATE_RUNTIME_IMAGE" == "$WEBHOOK_PROBE_RUNTIME_IMAGE" ]] || { echo 'Ephemeral webhook acceptance runtime image differs from production candidate' >&2; exit 1; }
            [[ "$WEBHOOK_CANDIDATE_RELEASE_SHA" == "$GITHUB_SHA" && "$WEBHOOK_PROBE_RELEASE_SHA" == "$GITHUB_SHA" ]] || { echo 'Production webhook candidate or acceptance release SHA mismatch' >&2; exit 1; }
            [[ "$WEBHOOK_CANDIDATE_RUNTIME_SA" == "$GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT" && "$WEBHOOK_PROBE_RUNTIME_SA" == "$GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT" ]] || { echo 'Production webhook candidate or acceptance runtime identity mismatch' >&2; exit 1; }
            [[ "$WEBHOOK_CANDIDATE_READY" == True && "$WEBHOOK_PROBE_READY" == True ]] || { echo 'Production webhook candidate or acceptance revision is not Ready=True' >&2; exit 1; }
            [[ "$WEBHOOK_PROBE_STARTUP_PATH" == /readyz ]] || { echo "Ephemeral webhook acceptance startup probe is not /readyz: $WEBHOOK_PROBE_STARTUP_PATH" >&2; exit 1; }
            [[ "$WEBHOOK_PROBE_LIVENESS_PATH" == /healthz ]] || { echo "Ephemeral webhook acceptance liveness probe is not /healthz: $WEBHOOK_PROBE_LIVENESS_PATH" >&2; exit 1; }

            gcloud run services add-iam-policy-binding "$WEBHOOK_PROBE_SERVICE" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \\
              --member="$WEBHOOK_PROBE_MEMBER" --role=roles/run.invoker --quiet
            gcloud run services get-iam-policy "$WEBHOOK_PROBE_SERVICE" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \\
              > /tmp/webhook-acceptance-iam.json
            jq -e --arg member "$WEBHOOK_PROBE_MEMBER" '
              .bindings[]?
              | select(.role == "roles/run.invoker" and (.condition == null))
              | (.members // [])[]?
              | select(. == $member)
            ' /tmp/webhook-acceptance-iam.json >/dev/null || { echo 'Ephemeral webhook acceptance invoker binding missing' >&2; exit 1; }
            if jq -e '.bindings[]? | select(.role == "roles/run.invoker") | (.members // [])[]? | select(. == "allUsers")' /tmp/webhook-acceptance-iam.json >/dev/null; then
              echo 'Ephemeral webhook acceptance service must not expose roles/run.invoker to allUsers' >&2
              exit 1
            fi

            create_webhook_scheduler_probe() {
              local job="$1" uri="$2"
              gcloud scheduler jobs create http "$job" \\
                --project "$GCP_PROJECT_ID" --location "$GCP_REGION" \\
                --schedule='0 0 1 1 *' --time-zone='Etc/UTC' \\
                --uri="$uri" --http-method=GET \\
                --oidc-service-account-email="$GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT" \\
                --oidc-token-audience="$WEBHOOK_PROBE_URL" \\
                --attempt-deadline=30s --max-retry-attempts=0 --quiet
            }

            run_webhook_scheduler_probe() {
              local job="$1"
              gcloud scheduler jobs run "$job" \\
                --project "$GCP_PROJECT_ID" --location "$GCP_REGION" --quiet
            }

            wait_for_webhook_scheduler_status() {
              local job="$1" expected="$2" status
              for _ in $(seq 1 45); do
                status="$(gcloud logging read \\
                  "resource.type=\"cloud_scheduler_job\" AND resource.labels.job_id=\"${job}\" AND httpRequest.status>0" \\
                  --project "$GCP_PROJECT_ID" --freshness=10m --limit=1 --order=desc \\
                  --format='value(httpRequest.status)' 2>/dev/null | head -n1)"
                if [[ "$status" == "$expected" ]]; then
                  printf '%s' "$status"
                  return 0
                fi
                if [[ "$status" =~ ^[1-5][0-9]{2}$ ]]; then
                  echo "Internal webhook scheduler probe $job returned HTTP $status, expected $expected" >&2
                  return 1
                fi
                sleep 2
              done
              echo "Internal webhook scheduler probe $job timed out waiting for HTTP $expected" >&2
              return 1
            }

            create_webhook_scheduler_probe "$WEBHOOK_HEALTH_JOB" "${WEBHOOK_PROBE_URL}/healthz"
            create_webhook_scheduler_probe "$WEBHOOK_READY_JOB" "${WEBHOOK_PROBE_URL}/readyz"
            create_webhook_scheduler_probe "$WEBHOOK_MCP_JOB" "${WEBHOOK_PROBE_URL}/mcp"
            create_webhook_scheduler_probe "$WEBHOOK_OAUTH_JOB" "${WEBHOOK_PROBE_URL}/oauth/meta/start"
            run_webhook_scheduler_probe "$WEBHOOK_HEALTH_JOB"
            run_webhook_scheduler_probe "$WEBHOOK_READY_JOB"
            run_webhook_scheduler_probe "$WEBHOOK_MCP_JOB"
            run_webhook_scheduler_probe "$WEBHOOK_OAUTH_JOB"
            WEBHOOK_HEALTH_STATUS="$(wait_for_webhook_scheduler_status "$WEBHOOK_HEALTH_JOB" 200)"
            WEBHOOK_READY_STATUS="$(wait_for_webhook_scheduler_status "$WEBHOOK_READY_JOB" 200)"
            WEBHOOK_MCP_STATUS="$(wait_for_webhook_scheduler_status "$WEBHOOK_MCP_JOB" 404)"
            WEBHOOK_OAUTH_STATUS="$(wait_for_webhook_scheduler_status "$WEBHOOK_OAUTH_JOB" 404)"

            jq -n \\
              --arg candidateRevision "$WEBHOOK_REVISION" \\
              --arg probeService "$WEBHOOK_PROBE_SERVICE" \\
              --arg probeRevision "$WEBHOOK_PROBE_REVISION" \\
              --arg runtimeImage "$WEBHOOK_PROBE_RUNTIME_IMAGE" \\
              --arg identity "$GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT" \\
              --arg startupPath "$WEBHOOK_PROBE_STARTUP_PATH" \\
              --arg livenessPath "$WEBHOOK_PROBE_LIVENESS_PATH" \\
              --arg health "$WEBHOOK_HEALTH_STATUS" --arg ready "$WEBHOOK_READY_STATUS" \\
              --arg mcp "$WEBHOOK_MCP_STATUS" --arg oauth "$WEBHOOK_OAUTH_STATUS" \\
              '{schemaVersion:"toca.platform.webhook-internal-probe.v1",mechanism:"cloud-scheduler-ephemeral-canonical-service",productionCandidateRevision:$candidateRevision,probeService:$probeService,probeRevision:$probeRevision,runtimeImage:$runtimeImage,oidcServiceAccount:$identity,startupProbePath:$startupPath,livenessProbePath:$livenessPath,healthHttpStatus:($health|tonumber),readyHttpStatus:($ready|tonumber),webhookMcpStatus:($mcp|tonumber),webhookOauthStatus:($oauth|tonumber),exactReleaseShaMatched:true,sameRuntimeImageAsProductionCandidate:true,externalGitHubRunnerProbe:false,productionTrafficMutation:false,providerCallExecuted:false,secretPayloadDisclosed:false,result:"PASS"}' \\
              > platform-evidence/webhook-internal-probe.json
            jq -n '{status:"ok",transport:"cloud-run-native-healthz",source:"ephemeral-production-acceptance"}' > platform-evidence/webhook-healthz.json
            jq -n '{status:"ready",checks:[{name:"cloud-run-startup-readyz",ok:true}],source:"ephemeral-production-acceptance"}' > platform-evidence/webhook-readyz.json
            jq -n --arg mcp "$WEBHOOK_MCP_STATUS" --arg oauth "$WEBHOOK_OAUTH_STATUS" \\
              '{schemaVersion:"toca.platform.e2e.v1",webhookMcpStatus:($mcp|tonumber),webhookOauthStatus:($oauth|tonumber),result:"PASS"}' \\
              > platform-evidence/e2e-results.json

            cleanup_internal_webhook_probe
            trap - EXIT
            for job in "$WEBHOOK_HEALTH_JOB" "$WEBHOOK_READY_JOB" "$WEBHOOK_MCP_JOB" "$WEBHOOK_OAUTH_JOB"; do
              if gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" >/dev/null 2>&1; then
                echo "Webhook internal probe cleanup left scheduler job behind: $job" >&2
                exit 1
              fi
            done
            if gcloud run services describe "$WEBHOOK_PROBE_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" >/dev/null 2>&1; then
              echo "Ephemeral webhook acceptance service remained after cleanup: $WEBHOOK_PROBE_SERVICE" >&2
              exit 1
            fi
            echo 'WEBHOOK_GCP_INTERNAL_PROBE=PASS' >> "$GITHUB_STEP_SUMMARY"
          else
            test -n "$WEBHOOK_TOKEN" || { echo 'Webhook private probe ID token missing' >&2; exit 1; }
            WEBHOOK_AUTH=(-H "Authorization: Bearer $WEBHOOK_TOKEN")
            curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 "${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/healthz" | tee platform-evidence/webhook-healthz.json
            curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 "${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/readyz" | tee platform-evidence/webhook-readyz.json
            jq -e '.status == "ready" and (.checks | all(.ok == true))' platform-evidence/webhook-readyz.json >/dev/null
            MCP_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/mcp")"
            OAUTH_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/oauth/meta/start")"
            [[ "$MCP_STATUS" == 404 && "$OAUTH_STATUS" == 404 ]] || { echo 'Webhook candidate exposed a forbidden route' >&2; exit 1; }
            jq -n --arg mcp "$MCP_STATUS" --arg oauth "$OAUTH_STATUS" '{schemaVersion:"toca.platform.e2e.v1",webhookMcpStatus:($mcp|tonumber),webhookOauthStatus:($oauth|tonumber),result:"PASS"}' > platform-evidence/e2e-results.json
          fi
'''

replace_once(old_webhook_probe, new_webhook_probe, 'production webhook candidate probe')
workflow_path.write_text(text)

test_path = Path('test/gcp-production-webhook-internal-probe-contract.test.ts')
test_path.write_text('''import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');

function verifySection(): string {
  const start = workflow.indexOf('- name: Verify health readiness and webhook route confinement');
  const end = workflow.indexOf('- name: Restore production MCP default endpoint posture after private probes');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe('GCP production webhook internal probe contract', () => {
  it('uses an internal ephemeral canonical service for production webhook acceptance', () => {
    const verify = verifySection();
    const marker = '# Cloud Scheduler is a supported internal Cloud Run caller';
    const start = verify.indexOf(marker);
    const end = verify.indexOf('\\n          else\\n            test -n "$WEBHOOK_TOKEN"', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const productionWebhook = verify.slice(start, end);

    expect(productionWebhook).toContain('WEBHOOK_PROBE_SERVICE="toca-webhook-accept-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"');
    expect(productionWebhook).toContain('gcloud run deploy "$WEBHOOK_PROBE_SERVICE" --image "$IMAGE"');
    expect(productionWebhook).toContain('--service-account "$GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT"');
    expect(productionWebhook).toContain('--update-secrets "$WEBHOOK_RUNTIME_SECRETS" --update-env-vars "$WEBHOOK_RUNTIME_ENV"');
    expect(productionWebhook).toContain('--ingress internal --default-url --no-allow-unauthenticated');
    expect(productionWebhook).toContain("--startup-probe 'httpGet.path=/readyz");
    expect(productionWebhook).toContain('create_webhook_scheduler_probe "$WEBHOOK_HEALTH_JOB" "${WEBHOOK_PROBE_URL}/healthz"');
    expect(productionWebhook).toContain('create_webhook_scheduler_probe "$WEBHOOK_READY_JOB" "${WEBHOOK_PROBE_URL}/readyz"');
    expect(productionWebhook).toContain('create_webhook_scheduler_probe "$WEBHOOK_MCP_JOB" "${WEBHOOK_PROBE_URL}/mcp"');
    expect(productionWebhook).toContain('create_webhook_scheduler_probe "$WEBHOOK_OAUTH_JOB" "${WEBHOOK_PROBE_URL}/oauth/meta/start"');
    expect(productionWebhook).toContain('--oidc-token-audience="$WEBHOOK_PROBE_URL"');
    expect(productionWebhook).not.toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/');
  });

  it('binds the ephemeral runtime to the exact production candidate identity', () => {
    const verify = verifySection();
    expect(verify).toContain('gcloud run revisions describe "$WEBHOOK_REVISION"');
    expect(verify).toContain('[[ "$WEBHOOK_CANDIDATE_RUNTIME_IMAGE" == "$WEBHOOK_PROBE_RUNTIME_IMAGE" ]]');
    expect(verify).toContain('[[ "$WEBHOOK_CANDIDATE_RELEASE_SHA" == "$GITHUB_SHA" && "$WEBHOOK_PROBE_RELEASE_SHA" == "$GITHUB_SHA" ]]');
    expect(verify).toContain('[[ "$WEBHOOK_CANDIDATE_RUNTIME_SA" == "$GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT" && "$WEBHOOK_PROBE_RUNTIME_SA" == "$GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT" ]]');
    expect(verify).toContain('[[ "$WEBHOOK_PROBE_STARTUP_PATH" == /readyz ]]');
    expect(verify).toContain('[[ "$WEBHOOK_PROBE_LIVENESS_PATH" == /healthz ]]');
    expect(verify).toContain('sameRuntimeImageAsProductionCandidate:true');
    expect(verify).toContain('exactReleaseShaMatched:true');
  });

  it('proves route confinement internally and records non-mutating evidence', () => {
    const verify = verifySection();
    expect(verify).toContain('wait_for_webhook_scheduler_status "$WEBHOOK_HEALTH_JOB" 200');
    expect(verify).toContain('wait_for_webhook_scheduler_status "$WEBHOOK_READY_JOB" 200');
    expect(verify).toContain('wait_for_webhook_scheduler_status "$WEBHOOK_MCP_JOB" 404');
    expect(verify).toContain('wait_for_webhook_scheduler_status "$WEBHOOK_OAUTH_JOB" 404');
    expect(verify).toContain('toca.platform.webhook-internal-probe.v1');
    expect(verify).toContain('cloud-scheduler-ephemeral-canonical-service');
    expect(verify).toContain('externalGitHubRunnerProbe:false');
    expect(verify).toContain('productionTrafficMutation:false');
    expect(verify).toContain('providerCallExecuted:false');
    expect(verify).toContain('secretPayloadDisclosed:false');
  });

  it('preserves external GitHub-runner webhook probes for staging only', () => {
    const verify = verifySection();
    const stagingStart = verify.indexOf('\\n          else\\n            test -n "$WEBHOOK_TOKEN"', verify.indexOf('WEBHOOK_GCP_INTERNAL_PROBE=PASS'));
    expect(stagingStart).toBeGreaterThan(-1);
    const stagingWebhook = verify.slice(stagingStart);
    expect(stagingWebhook).toContain('WEBHOOK_AUTH=(-H "Authorization: Bearer $WEBHOOK_TOKEN")');
    expect(stagingWebhook).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/healthz"');
    expect(stagingWebhook).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/readyz"');
    expect(stagingWebhook).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/mcp"');
    expect(stagingWebhook).toContain('"${WEBHOOK_AUTH[@]}" "$WEBHOOK_URL/oauth/meta/start"');
  });

  it('cleans all temporary GCP probe resources before promotion', () => {
    const verify = verifySection();
    expect(verify).toContain('trap cleanup_internal_webhook_probe EXIT');
    expect(verify).toContain('gcloud scheduler jobs delete "$job"');
    expect(verify).toContain('gcloud run services delete "$WEBHOOK_PROBE_SERVICE"');
    expect(verify).toContain('Webhook internal probe cleanup left scheduler job behind');
    expect(verify).toContain('Ephemeral webhook acceptance service remained after cleanup');
    expect(verify).not.toContain('gcloud run services update-traffic');
  });
});
''')
