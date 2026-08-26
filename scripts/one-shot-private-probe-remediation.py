from pathlib import Path

workflow_path = Path('.github/workflows/deploy-gcp.yml')
workflow = workflow_path.read_text()
step_marker = '- name: Verify health readiness and webhook route confinement'
step_index = workflow.index(step_marker)
start_marker = '          if [[ "$DEPLOY_ENVIRONMENT" == production ]]; then'
start = workflow.index(start_marker, step_index)
end = workflow.index('\n          else\n', start)

replacement = '''          if [[ "$DEPLOY_ENVIRONMENT" == production ]]; then
            test -n "$MCP_REVISION" || { echo 'MCP exact candidate revision missing' >&2; exit 1; }

            gcloud run services describe "$GCP_CLOUD_RUN_MCP_SERVICE" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \\
              > /tmp/mcp-internal-probe-posture.json
            MCP_INGRESS="$(jq -r '.metadata.annotations["run.googleapis.com/ingress"] // "all"' /tmp/mcp-internal-probe-posture.json)"
            MCP_DEFAULT_URL_DISABLED="$(jq -r '.metadata.annotations["run.googleapis.com/default-url-disabled"] // "false"' /tmp/mcp-internal-probe-posture.json)"
            case "$MCP_INGRESS" in
              internal|internal-and-cloud-load-balancing) ;;
              *) echo "Production MCP ingress is not private: $MCP_INGRESS" >&2; exit 1 ;;
            esac
            [[ "$MCP_DEFAULT_URL_DISABLED" == false ]] || { echo 'Production MCP default URL must be enabled only during the private probe window' >&2; exit 1; }

            gcloud run services get-iam-policy "$GCP_CLOUD_RUN_MCP_SERVICE" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \\
              > /tmp/mcp-internal-probe-iam-before.json
            if jq -e '.bindings[]? | select(.role == "roles/run.invoker") | (.members // [])[]? | select(. == "allUsers")' \\
              /tmp/mcp-internal-probe-iam-before.json >/dev/null; then
              echo 'Production MCP must not expose roles/run.invoker to allUsers' >&2
              exit 1
            fi

            # Cloud Scheduler is an internal Cloud Run source only when it invokes a service's
            # default run.app URL. A traffic-tagged run.app hostname is rejected by the Cloud Run
            # frontend before revision routing under internal ingress. Validate the exact immutable
            # candidate through a short-lived sibling service that keeps the same runtime image,
            # identity, Cloud SQL attachment, secrets, env and probes, but exposes its canonical
            # default URL only to authenticated internal callers.
            PROBE_SERVICE="toca-mcp-accept-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
            PROBE_MEMBER="serviceAccount:${GCP_MCP_RUNTIME_SERVICE_ACCOUNT}"
            HEALTH_JOB="toca-mcp-health-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
            READY_JOB="toca-mcp-ready-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"

            cleanup_internal_mcp_probe() {
              set +e
              for job in "$HEALTH_JOB" "$READY_JOB"; do
                gcloud scheduler jobs delete "$job" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" --quiet >/dev/null 2>&1 || true
              done
              gcloud run services delete "$PROBE_SERVICE" \\
                --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1 || true
              set -e
            }
            trap cleanup_internal_mcp_probe EXIT

            gcloud run deploy "$PROBE_SERVICE" --image "$IMAGE" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \\
              --revision-suffix "probe-${GITHUB_SHA::8}" \\
              --service-account "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT" \\
              --add-cloudsql-instances "${GCP_PROJECT_ID}:${GCP_REGION}:${GCP_CLOUD_SQL_INSTANCE}" \\
              --update-secrets "$MCP_RUNTIME_SECRETS" --update-env-vars "$MCP_RUNTIME_ENV" \\
              --startup-probe 'httpGet.path=/healthz,httpGet.port=8080,failureThreshold=20,timeoutSeconds=3,periodSeconds=3' \\
              --liveness-probe 'httpGet.path=/healthz,httpGet.port=8080,failureThreshold=3,timeoutSeconds=3,periodSeconds=10' \\
              --min-instances 0 --max-instances 1 \\
              --cpu-throttling --memory "${{ vars.GCP_MCP_MEMORY || '512Mi' }}" --cpu "${{ vars.GCP_MCP_CPU || '1' }}" \\
              --ingress internal --default-url --no-allow-unauthenticated --quiet

            gcloud run services describe "$PROBE_SERVICE" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \\
              > /tmp/mcp-acceptance-service.json
            PROBE_URL="$(jq -r '.status.url // empty' /tmp/mcp-acceptance-service.json)"
            PROBE_REVISION="$(jq -r '.status.latestReadyRevisionName // empty' /tmp/mcp-acceptance-service.json)"
            PROBE_INGRESS="$(jq -r '.metadata.annotations["run.googleapis.com/ingress"] // "all"' /tmp/mcp-acceptance-service.json)"
            PROBE_DEFAULT_URL_DISABLED="$(jq -r '.metadata.annotations["run.googleapis.com/default-url-disabled"] // "false"' /tmp/mcp-acceptance-service.json)"
            test -n "$PROBE_URL" || { echo 'Ephemeral MCP acceptance service has no canonical run.app URL' >&2; exit 1; }
            test -n "$PROBE_REVISION" || { echo 'Ephemeral MCP acceptance service has no Ready revision' >&2; exit 1; }
            [[ "$PROBE_INGRESS" == internal ]] || { echo "Ephemeral MCP acceptance ingress is not internal: $PROBE_INGRESS" >&2; exit 1; }
            [[ "$PROBE_DEFAULT_URL_DISABLED" == false ]] || { echo 'Ephemeral MCP acceptance default URL is disabled' >&2; exit 1; }

            gcloud run revisions describe "$MCP_REVISION" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \\
              > /tmp/mcp-production-candidate-revision.json
            gcloud run revisions describe "$PROBE_REVISION" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \\
              > /tmp/mcp-acceptance-revision.json

            CANDIDATE_RUNTIME_IMAGE="$(jq -r '.spec.containers[0].image // empty' /tmp/mcp-production-candidate-revision.json)"
            PROBE_RUNTIME_IMAGE="$(jq -r '.spec.containers[0].image // empty' /tmp/mcp-acceptance-revision.json)"
            CANDIDATE_RELEASE_SHA="$(jq -r '[.spec.containers[0].env[]? | select(.name == "TOCA_RELEASE_SHA") | .value] | unique | if length == 1 then .[0] else empty end' /tmp/mcp-production-candidate-revision.json)"
            PROBE_RELEASE_SHA="$(jq -r '[.spec.containers[0].env[]? | select(.name == "TOCA_RELEASE_SHA") | .value] | unique | if length == 1 then .[0] else empty end' /tmp/mcp-acceptance-revision.json)"
            CANDIDATE_RUNTIME_SA="$(jq -r '.spec.serviceAccountName // empty' /tmp/mcp-production-candidate-revision.json)"
            PROBE_RUNTIME_SA="$(jq -r '.spec.serviceAccountName // empty' /tmp/mcp-acceptance-revision.json)"
            CANDIDATE_READY="$(jq -r '[.status.conditions[]? | select(.type == "Ready") | .status] | last // empty' /tmp/mcp-production-candidate-revision.json)"
            PROBE_READY="$(jq -r '[.status.conditions[]? | select(.type == "Ready") | .status] | last // empty' /tmp/mcp-acceptance-revision.json)"

            test -n "$CANDIDATE_RUNTIME_IMAGE" || { echo 'Production candidate runtime image missing' >&2; exit 1; }
            [[ "$CANDIDATE_RUNTIME_IMAGE" == "$PROBE_RUNTIME_IMAGE" ]] || { echo 'Ephemeral acceptance runtime image differs from production candidate runtime image' >&2; exit 1; }
            [[ "$CANDIDATE_RELEASE_SHA" == "$GITHUB_SHA" && "$PROBE_RELEASE_SHA" == "$GITHUB_SHA" ]] || { echo 'Production candidate or ephemeral acceptance release SHA mismatch' >&2; exit 1; }
            [[ "$CANDIDATE_RUNTIME_SA" == "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT" && "$PROBE_RUNTIME_SA" == "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT" ]] || { echo 'Production candidate or ephemeral acceptance runtime identity mismatch' >&2; exit 1; }
            [[ "$CANDIDATE_READY" == True && "$PROBE_READY" == True ]] || { echo 'Production candidate or ephemeral acceptance revision is not Ready=True' >&2; exit 1; }

            gcloud run services add-iam-policy-binding "$PROBE_SERVICE" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \\
              --member="$PROBE_MEMBER" --role=roles/run.invoker --quiet
            gcloud run services get-iam-policy "$PROBE_SERVICE" \\
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \\
              > /tmp/mcp-acceptance-iam.json
            jq -e --arg member "$PROBE_MEMBER" '
              .bindings[]?
              | select(.role == "roles/run.invoker" and (.condition == null))
              | (.members // [])[]?
              | select(. == $member)
            ' /tmp/mcp-acceptance-iam.json >/dev/null || { echo 'Ephemeral MCP acceptance invoker binding missing' >&2; exit 1; }
            if jq -e '.bindings[]? | select(.role == "roles/run.invoker") | (.members // [])[]? | select(. == "allUsers")' /tmp/mcp-acceptance-iam.json >/dev/null; then
              echo 'Ephemeral MCP acceptance service must not expose roles/run.invoker to allUsers' >&2
              exit 1
            fi

            create_scheduler_probe() {
              local job="$1" uri="$2"
              gcloud scheduler jobs create http "$job" \\
                --project "$GCP_PROJECT_ID" --location "$GCP_REGION" \\
                --schedule='0 0 1 1 *' --time-zone='Etc/UTC' \\
                --uri="$uri" --http-method=GET \\
                --oidc-service-account-email="$GCP_MCP_RUNTIME_SERVICE_ACCOUNT" \\
                --oidc-token-audience="$PROBE_URL" \\
                --attempt-deadline=30s --max-retry-attempts=0 --quiet
            }

            wait_for_scheduler_2xx() {
              local job="$1" status
              gcloud scheduler jobs run "$job" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" --quiet
              for _ in $(seq 1 45); do
                status="$(gcloud logging read \\
                  "resource.type=\\"cloud_scheduler_job\\" AND resource.labels.job_id=\\"${job}\\" AND httpRequest.status>=200 AND httpRequest.status<300" \\
                  --project "$GCP_PROJECT_ID" --freshness=10m --limit=1 --order=desc \\
                  --format='value(httpRequest.status)' 2>/dev/null | head -n1)"
                if [[ "$status" =~ ^2[0-9]{2}$ ]]; then
                  printf '%s' "$status"
                  return 0
                fi
                status="$(gcloud logging read \\
                  "resource.type=\\"cloud_scheduler_job\\" AND resource.labels.job_id=\\"${job}\\" AND httpRequest.status>=300" \\
                  --project "$GCP_PROJECT_ID" --freshness=10m --limit=1 --order=desc \\
                  --format='value(httpRequest.status)' 2>/dev/null | head -n1)"
                if [[ "$status" =~ ^[345][0-9]{2}$ ]]; then
                  echo "Internal MCP scheduler probe $job failed with HTTP $status" >&2
                  return 1
                fi
                sleep 2
              done
              echo "Internal MCP scheduler probe $job timed out without a terminal HTTP status" >&2
              return 1
            }

            create_scheduler_probe "$HEALTH_JOB" "${PROBE_URL}/healthz"
            create_scheduler_probe "$READY_JOB" "${PROBE_URL}/readyz"
            HEALTH_STATUS="$(wait_for_scheduler_2xx "$HEALTH_JOB")"
            READY_STATUS="$(wait_for_scheduler_2xx "$READY_JOB")"

            jq -n \\
              --arg ingress "$MCP_INGRESS" \\
              --arg productionCandidateRevision "$MCP_REVISION" \\
              --arg probeService "$PROBE_SERVICE" \\
              --arg probeRevision "$PROBE_REVISION" \\
              --arg target "$PROBE_URL" \\
              --arg identity "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT" \\
              --arg runtimeImage "$PROBE_RUNTIME_IMAGE" \\
              --arg health "$HEALTH_STATUS" \\
              --arg ready "$READY_STATUS" \\
              '{schemaVersion:"toca.platform.mcp-internal-probe.v2",mechanism:"cloud-scheduler-ephemeral-canonical-service",ingress:$ingress,productionCandidateRevision:$productionCandidateRevision,probeService:$probeService,probeRevision:$probeRevision,canonicalProbeTarget:$target,oidcAudience:$target,oidcServiceAccount:$identity,runtimeImage:$runtimeImage,exactReleaseShaMatched:true,sameRuntimeImageAsProductionCandidate:true,healthHttpStatus:($health|tonumber),readyHttpStatus:($ready|tonumber),externalGitHubRunnerProbe:false,productionTrafficMutation:false,providerCallExecuted:false,result:"PASS"}' \\
              > platform-evidence/mcp-internal-probe.json

            cleanup_internal_mcp_probe
            trap - EXIT
            for job in "$HEALTH_JOB" "$READY_JOB"; do
              if gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" >/dev/null 2>&1; then
                echo "Internal MCP probe cleanup left scheduler job behind: $job" >&2
                exit 1
              fi
            done
            if gcloud run services describe "$PROBE_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" >/dev/null 2>&1; then
              echo "Ephemeral MCP acceptance service remained after cleanup: $PROBE_SERVICE" >&2
              exit 1
            fi
            echo 'MCP_INTERNAL_ORIGIN_PROBE=PASS' >> "$GITHUB_STEP_SUMMARY"
'''

workflow_path.write_text(workflow[:start] + replacement + workflow[end:])
