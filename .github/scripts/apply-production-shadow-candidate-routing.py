from pathlib import Path

workflow_path = Path('.github/workflows/instagram-engagement-shadow-production.yml')
workflow = workflow_path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global workflow
    if old not in workflow:
        raise SystemExit(f'missing anchor: {label}')
    workflow = workflow.replace(old, new, 1)


replace_once(
    '  WEBHOOK_SERVICE_NAME: toca-webhook-next-production\n',
    '  WEBHOOK_SERVICE_NAME: toca-webhook-next-production\n  SCHEDULER_JOB_NAME: toca-managed-instagram-tick\n',
    'scheduler env',
)

start = '      - name: Deploy shadow runtime and expose webhook with DRS-safe invoker mode\n'
end = '      - name: Verify DRS-safe public callback and fail-closed writes\n'
if start not in workflow or end not in workflow:
    raise SystemExit('deployment step markers missing')
pre, rest = workflow.split(start, 1)
_, post = rest.split(end, 1)

deploy = r'''      - name: Deploy shadow runtime and expose webhook with DRS-safe invoker mode
        shell: bash
        run: |
          set -euo pipefail

          RUN_TAIL="${GITHUB_RUN_ID: -7}"
          DAEMON_REVISION_SUFFIX="d${RUN_TAIL}a${GITHUB_RUN_ATTEMPT}"
          WEBHOOK_REVISION_SUFFIX="w${RUN_TAIL}a${GITHUB_RUN_ATTEMPT}"
          EXPECTED_DAEMON_CANDIDATE_REVISION="${DAEMON_SERVICE_NAME}-${DAEMON_REVISION_SUFFIX}"
          EXPECTED_WEBHOOK_CANDIDATE_REVISION="${WEBHOOK_SERVICE_NAME}-${WEBHOOK_REVISION_SUFFIX}"

          gcloud run services update "$DAEMON_SERVICE_NAME" \
            --image "$RUNTIME_IMAGE" \
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
            --service-account "$GCP_RUNTIME_SERVICE_ACCOUNT" \
            --add-cloudsql-instances "$CLOUD_SQL_INSTANCE" \
            --update-secrets "DATABASE_URL=$DATABASE_SECRET_ID:latest" \
            --revision-suffix="$DAEMON_REVISION_SUFFIX" \
            --update-env-vars "INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true,INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false,INSTAGRAM_ENGAGEMENT_TENANT_ID=$TOCA_TENANT_ID,INSTAGRAM_ENGAGEMENT_WORKSPACE_ID=$TOCA_WORKSPACE_ID,INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID=$TOCA_ORGANIZATION_ID,INSTAGRAM_ENGAGEMENT_PAGE_ID=$INSTAGRAM_PAGE_ID,INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID=$CANONICAL_FAQ_SPREADSHEET_ID,INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SOURCE=postgres,INSTAGRAM_BUSINESS_ACCOUNT_ID=$INSTAGRAM_ACCOUNT_ID,INSTAGRAM_ENGAGEMENT_SHADOW_RUN_ID=$GITHUB_RUN_ID" \
            --command node --args dist/src/toca-managed-instagram-daemon.js --quiet

          DAEMON_REVISION_JSON="$(gcloud run revisions describe "$EXPECTED_DAEMON_CANDIDATE_REVISION" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          printf '%s' "$DAEMON_REVISION_JSON" | jq -e \
            --arg expected "$EXPECTED_DAEMON_CANDIDATE_REVISION" \
            --arg digest "$RUNTIME_IMAGE_DIGEST" \
            --arg sa "$GCP_RUNTIME_SERVICE_ACCOUNT" \
            --arg runId "$GITHUB_RUN_ID" '
            .spec.containers[0] as $c |
            def envValue($name): ([($c.env // [])[] | select(.name == $name) | .value] | last // null);
            (.metadata.name == $expected) and
            (.spec.serviceAccountName == $sa) and
            ($c.image | contains($digest)) and
            ($c.command == ["node"]) and
            ($c.args == ["dist/src/toca-managed-instagram-daemon.js"]) and
            (envValue("INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED") == "true") and
            (envValue("INSTAGRAM_ENGAGEMENT_WRITES_ENABLED") == "false") and
            (envValue("INSTAGRAM_ENGAGEMENT_SHADOW_RUN_ID") == $runId)
          ' >/dev/null || { echo 'Daemon candidate revision contract mismatch' >&2; exit 1; }

          gcloud run services update-traffic "$DAEMON_SERVICE_NAME" \
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
            --to-revisions="${EXPECTED_DAEMON_CANDIDATE_REVISION}=100" --quiet

          DAEMON_ROUTED_JSON="$(gcloud run services describe "$DAEMON_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          printf '%s' "$DAEMON_ROUTED_JSON" | jq -e --arg revision "$EXPECTED_DAEMON_CANDIDATE_REVISION" '
            ([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | length == 1) and
            ([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision)
          ' >/dev/null || { echo 'Daemon candidate must own exactly 100% traffic before proof' >&2; exit 1; }
          echo "DAEMON_CANDIDATE_REVISION=$EXPECTED_DAEMON_CANDIDATE_REVISION" >> "$GITHUB_ENV"

          WEBHOOK_ENV="^@^NODE_ENV=production@MCP_ENABLED=false@TOCA_SERVICE_ROLE=webhook@TOCA_DEFAULT_TENANT_ID=$TOCA_TENANT_ID@TOCA_DEFAULT_WORKSPACE_ID=$TOCA_WORKSPACE_ID@TOCA_DEFAULT_ORGANIZATION_ID=$TOCA_ORGANIZATION_ID@META_ENABLED=true@META_PROVIDER_VERIFIED=true@META_WEBHOOK_ENABLED=true@META_WEBHOOK_PERSISTENCE_ENABLED=true@META_APP_ID=$META_APP_ID@META_APP_SECRET_PROVIDER=env@META_APP_SECRET_KEY=META_APP_SECRET@META_AUTHORIZATION_ENDPOINT=https://www.facebook.com/dialog/oauth@META_TOKEN_ENDPOINT=https://graph.facebook.com/oauth/access_token@META_REDIRECT_URI=$META_REDIRECT_URI@META_REQUESTED_SCOPES=$META_REQUESTED_SCOPES@META_GRAPH_BASE_URL=https://graph.facebook.com@META_GRAPH_API_VERSION=v24.0@INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true@INSTAGRAM_ENGAGEMENT_TENANT_ID=$TOCA_TENANT_ID@INSTAGRAM_ENGAGEMENT_WORKSPACE_ID=$TOCA_WORKSPACE_ID@INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID=$TOCA_ORGANIZATION_ID@INSTAGRAM_ENGAGEMENT_SHADOW_RUN_ID=$GITHUB_RUN_ID@INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false@INSTAGRAM_BUSINESS_ACCOUNT_ID=$INSTAGRAM_ACCOUNT_ID"

          if [[ "${PREVIOUS_WEBHOOK_SERVICE_EXISTED:-false}" == true ]]; then
            gcloud run services update "$WEBHOOK_SERVICE_NAME" \
              --image "$RUNTIME_IMAGE" \
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
              --service-account "$GCP_RUNTIME_SERVICE_ACCOUNT" \
              --add-cloudsql-instances "$CLOUD_SQL_INSTANCE" \
              --update-secrets "DATABASE_URL=$DATABASE_SECRET_ID:latest,META_APP_SECRET=$META_APP_SECRET_ID:latest" \
              --revision-suffix="$WEBHOOK_REVISION_SUFFIX" \
              --update-env-vars "$WEBHOOK_ENV" \
              --command node --args dist/src/http-instagram-engagement.js \
              --quiet
          else
            gcloud run deploy "$WEBHOOK_SERVICE_NAME" \
              --image "$RUNTIME_IMAGE" \
              --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
              --service-account "$GCP_RUNTIME_SERVICE_ACCOUNT" \
              --add-cloudsql-instances "$CLOUD_SQL_INSTANCE" \
              --update-secrets "DATABASE_URL=$DATABASE_SECRET_ID:latest,META_APP_SECRET=$META_APP_SECRET_ID:latest" \
              --revision-suffix="$WEBHOOK_REVISION_SUFFIX" \
              --update-env-vars "$WEBHOOK_ENV" \
              --command node --args dist/src/http-instagram-engagement.js \
              --no-allow-unauthenticated \
              --quiet
          fi

          # The callback stays closed until the exact verified candidate owns all traffic.
          gcloud run services update "$WEBHOOK_SERVICE_NAME" \
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
            --no-default-url --invoker-iam-check --quiet

          WEBHOOK_REVISION_JSON="$(gcloud run revisions describe "$EXPECTED_WEBHOOK_CANDIDATE_REVISION" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          printf '%s' "$WEBHOOK_REVISION_JSON" | jq -e \
            --arg expected "$EXPECTED_WEBHOOK_CANDIDATE_REVISION" \
            --arg digest "$RUNTIME_IMAGE_DIGEST" \
            --arg sa "$GCP_RUNTIME_SERVICE_ACCOUNT" \
            --arg runId "$GITHUB_RUN_ID" '
            .spec.containers[0] as $c |
            def envValue($name): ([($c.env // [])[] | select(.name == $name) | .value] | last // null);
            (.metadata.name == $expected) and
            (.spec.serviceAccountName == $sa) and
            ($c.image | contains($digest)) and
            ($c.command == ["node"]) and
            ($c.args == ["dist/src/http-instagram-engagement.js"]) and
            (envValue("META_WEBHOOK_PERSISTENCE_ENABLED") == "true") and
            (envValue("INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED") == "true") and
            (envValue("INSTAGRAM_ENGAGEMENT_WRITES_ENABLED") == "false") and
            (envValue("INSTAGRAM_ENGAGEMENT_SHADOW_RUN_ID") == $runId)
          ' >/dev/null || { echo 'Webhook candidate revision contract mismatch' >&2; exit 1; }

          gcloud run services update-traffic "$WEBHOOK_SERVICE_NAME" \
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
            --to-revisions="${EXPECTED_WEBHOOK_CANDIDATE_REVISION}=100" --quiet

          WEBHOOK_ROUTED_JSON="$(gcloud run services describe "$WEBHOOK_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          printf '%s' "$WEBHOOK_ROUTED_JSON" | jq -e --arg revision "$EXPECTED_WEBHOOK_CANDIDATE_REVISION" '
            ([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | length == 1) and
            ([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision) and
            ((.metadata.annotations["run.googleapis.com/default-url-disabled"] // "false") == "true")
          ' >/dev/null || { echo 'Webhook candidate must own exactly 100% traffic while callback remains closed' >&2; exit 1; }
          echo "WEBHOOK_CANDIDATE_REVISION=$EXPECTED_WEBHOOK_CANDIDATE_REVISION" >> "$GITHUB_ENV"

          # Expose only the exact routed candidate through the DRS-safe invoker mode.
          gcloud run services update "$WEBHOOK_SERVICE_NAME" \
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
            --default-url --quiet
          gcloud run services update "$WEBHOOK_SERVICE_NAME" \
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
            --default-url --no-invoker-iam-check --quiet

'''
workflow = pre + deploy + end + post

verify_anchor = '''          DAEMON_JSON="$(gcloud run services describe "$DAEMON_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          WEBHOOK_JSON="$(gcloud run services describe "$WEBHOOK_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
'''
verify_insert = verify_anchor + '''
          printf '%s' "$DAEMON_JSON" | jq -e --arg revision "$DAEMON_CANDIDATE_REVISION" '\n            ([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | length == 1) and\n            ([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision)\n          ' >/dev/null || { echo 'Daemon candidate traffic drift before proof' >&2; exit 1; }
          printf '%s' "$WEBHOOK_JSON" | jq -e --arg revision "$WEBHOOK_CANDIDATE_REVISION" '\n            ([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | length == 1) and\n            ([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision)\n          ' >/dev/null || { echo 'Webhook candidate traffic drift before proof' >&2; exit 1; }
'''
replace_once(verify_anchor, verify_insert, 'candidate traffic verify')

# Strengthen the original COMMENT/DIRECT proof with exact candidate checks and authenticated scheduler ticks.
old_job = '          JOB="toca-ig-eng-shadow-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"\n'
replace_once(old_job, old_job + "          TICK_PID=''\n", 'shadow proof tick pid')
old_cleanup = '''          cleanup() {
            gcloud run jobs delete "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1 || true
          }
'''
new_cleanup = '''          cleanup() {
            if [[ -n "$TICK_PID" ]]; then kill "$TICK_PID" >/dev/null 2>&1 || true; wait "$TICK_PID" >/dev/null 2>&1 || true; fi
            gcloud run jobs delete "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1 || true
          }
'''
replace_once(old_cleanup, new_cleanup, 'shadow proof cleanup')
proof_deploy_anchor = '''          gcloud run jobs deploy "$JOB" \\
            --image "$RUNTIME_IMAGE" \\
'''
proof_precheck = '''          DAEMON_ROUTED_JSON="$(gcloud run services describe "$DAEMON_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          WEBHOOK_ROUTED_JSON="$(gcloud run services describe "$WEBHOOK_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          printf '%s' "$DAEMON_ROUTED_JSON" | jq -e --arg revision "$DAEMON_CANDIDATE_REVISION" '([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision)' >/dev/null
          printf '%s' "$WEBHOOK_ROUTED_JSON" | jq -e --arg revision "$WEBHOOK_CANDIDATE_REVISION" '([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision)' >/dev/null

          DAEMON_URL="$(printf '%s' "$DAEMON_ROUTED_JSON" | jq -r '.status.url // empty')"
          SCHEDULER_JSON="$(gcloud scheduler jobs describe "$SCHEDULER_JOB_NAME" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" --format=json)"
          printf '%s' "$SCHEDULER_JSON" | jq -e --arg uri "${DAEMON_URL}/tick" --arg sa "$GCP_RUNTIME_SERVICE_ACCOUNT" --arg audience "$DAEMON_URL" '\n            (.httpTarget.uri == $uri) and\n            (.httpTarget.httpMethod == "POST") and\n            (.httpTarget.oidcToken.serviceAccountEmail == $sa) and\n            (.httpTarget.oidcToken.audience == $audience)\n          ' >/dev/null || { echo 'Scheduler target/OIDC boundary mismatch' >&2; exit 1; }

'''
replace_once(proof_deploy_anchor, proof_precheck + proof_deploy_anchor, 'shadow proof candidate precheck')
old_execute = '''          gcloud run jobs execute "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --wait --quiet

          LOG_ENTRIES="$(gcloud logging read "resource.type=\\"cloud_run_job\\" AND resource.labels.job_name=\\"${JOB}\\"" --project "$GCP_PROJECT_ID" --freshness=20m --limit=200 --order=asc --format=json || true)"
'''
new_execute = '''          tick_pump() {
            sleep 8
            for attempt in $(seq 1 20); do
              gcloud scheduler jobs run "$SCHEDULER_JOB_NAME" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" --quiet || return 1
              sleep 10
            done
          }
          tick_pump &
          TICK_PID=$!

          set +e
          gcloud run jobs execute "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --wait --quiet
          PROOF_RC=$?
          set -e
          kill "$TICK_PID" >/dev/null 2>&1 || true
          wait "$TICK_PID" >/dev/null 2>&1 || true
          TICK_PID=''

          LOG_ENTRIES="$(gcloud logging read "resource.type=\\"cloud_run_job\\" AND resource.labels.job_name=\\"${JOB}\\"" --project "$GCP_PROJECT_ID" --freshness=20m --limit=300 --order=asc --format=json || true)"
          if [[ "$PROOF_RC" -ne 0 ]]; then
            printf '%s\\n' "$LOG_ENTRIES" | jq '[.[] | {timestamp,severity,textPayload,jsonPayload,labels}]' > engagement-evidence/proof-job-sanitized-logs.json || true
            echo 'Synthetic COMMENT/DIRECT proof failed against exact routed candidates after authenticated tick pump' >&2
            exit "$PROOF_RC"
          fi
'''
replace_once(old_execute, new_execute, 'shadow proof execute')

# Strengthen the Conversation Operations proof with the same authenticated tick pump.
conversation_job = '          JOB="toca-ig-conversation-shadow-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"\n'
replace_once(conversation_job, conversation_job + "          TICK_PID=''\n", 'conversation proof tick pid')
# Replace the next cleanup occurrence only (the first was already modified and no longer matches old_cleanup).
replace_once(old_cleanup, new_cleanup, 'conversation proof cleanup')
conversation_execute = '''          gcloud run jobs execute "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --wait --quiet

          LOG_ENTRIES="$(gcloud logging read "resource.type=\\"cloud_run_job\\" AND resource.labels.job_name=\\"${JOB}\\"" --project "$GCP_PROJECT_ID" --freshness=20m --limit=300 --order=asc --format=json || true)"
'''
conversation_replacement = '''          tick_pump() {
            sleep 8
            for attempt in $(seq 1 25); do
              gcloud scheduler jobs run "$SCHEDULER_JOB_NAME" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" --quiet || return 1
              sleep 10
            done
          }
          tick_pump &
          TICK_PID=$!

          set +e
          gcloud run jobs execute "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --wait --quiet
          PROOF_RC=$?
          set -e
          kill "$TICK_PID" >/dev/null 2>&1 || true
          wait "$TICK_PID" >/dev/null 2>&1 || true
          TICK_PID=''

          LOG_ENTRIES="$(gcloud logging read "resource.type=\\"cloud_run_job\\" AND resource.labels.job_name=\\"${JOB}\\"" --project "$GCP_PROJECT_ID" --freshness=20m --limit=300 --order=asc --format=json || true)"
          if [[ "$PROOF_RC" -ne 0 ]]; then
            printf '%s\\n' "$LOG_ENTRIES" | jq '[.[] | {timestamp,severity,textPayload,jsonPayload,labels}]' > engagement-evidence/conversation-proof-job-sanitized-logs.json || true
            echo 'Conversation Operations proof failed against exact routed candidates after authenticated tick pump' >&2
            exit "$PROOF_RC"
          fi
'''
replace_once(conversation_execute, conversation_replacement, 'conversation proof execute')

closeout_old = 'syntheticShadowProof:"PASS",conversationShadowProof:"PASS",externalReplyWritesEnabled:false'
closeout_new = 'syntheticShadowProof:"PASS",conversationShadowProof:"PASS",daemonCandidateRevision:$daemonCandidate,daemonCandidateTrafficPercent:100,webhookCandidateRevision:$webhookCandidate,webhookCandidateTrafficPercent:100,tickPumpUsed:true,externalReplyWritesEnabled:false'
if closeout_old not in workflow:
    raise SystemExit('closeout payload anchor missing')
workflow = workflow.replace(
    '            --arg sheet "$CANONICAL_FAQ_SPREADSHEET_ID" \\\n',
    '            --arg sheet "$CANONICAL_FAQ_SPREADSHEET_ID" \\\n            --arg daemonCandidate "$DAEMON_CANDIDATE_REVISION" \\\n            --arg webhookCandidate "$WEBHOOK_CANDIDATE_REVISION" \\\n',
    1,
)
workflow = workflow.replace(closeout_old, closeout_new, 1)
workflow_path.write_text(workflow)

Path('test/instagram-engagement-production-shadow-candidate-routing.test.ts').write_text(r'''import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-production.yml',
  'utf8',
);

describe('Instagram production shadow exact candidate routing', () => {
  it('creates deterministic daemon and webhook candidates and routes each to 100 percent', () => {
    expect(workflow).toContain('DAEMON_REVISION_SUFFIX=');
    expect(workflow).toContain('WEBHOOK_REVISION_SUFFIX=');
    expect(workflow).toContain('--revision-suffix="$DAEMON_REVISION_SUFFIX"');
    expect(workflow).toContain('--revision-suffix="$WEBHOOK_REVISION_SUFFIX"');
    expect(workflow).toContain('--to-revisions="${EXPECTED_DAEMON_CANDIDATE_REVISION}=100"');
    expect(workflow).toContain('--to-revisions="${EXPECTED_WEBHOOK_CANDIDATE_REVISION}=100"');
    expect(workflow).toContain('Daemon candidate must own exactly 100% traffic before proof');
    expect(workflow).toContain('Webhook candidate must own exactly 100% traffic while callback remains closed');
  });

  it('keeps the callback closed until the exact webhook candidate owns traffic', () => {
    expect(workflow).toContain('--no-default-url --invoker-iam-check');
    expect(workflow).toContain('callback stays closed until the exact verified candidate owns all traffic');
    expect(workflow).toContain('--default-url --no-invoker-iam-check');
  });

  it('proves both shadow stages with authenticated scheduler ticks', () => {
    expect(workflow).toContain('SCHEDULER_JOB_NAME: toca-managed-instagram-tick');
    expect(workflow).toContain('tick_pump()');
    expect(workflow).toContain('gcloud scheduler jobs run "$SCHEDULER_JOB_NAME"');
    expect(workflow).toContain('Scheduler target/OIDC boundary mismatch');
    expect(workflow).toContain('tickPumpUsed:true');
  });

  it('remains fail closed for external replies while routing candidates', () => {
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(workflow).toContain('.replyOutboxEvents == 0');
    expect(workflow).toContain('.externalReplyObserved == false');
  });
});
''')
