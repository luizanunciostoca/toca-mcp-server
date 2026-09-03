from pathlib import Path

workflow_path = Path('.github/workflows/instagram-engagement-shadow-production.yml')
workflow = workflow_path.read_text()

readiness_start = '      - name: Run fail-closed readiness on PostgreSQL knowledge mirror\n'
deploy_start = '      - name: Deploy shadow runtime and expose webhook with DRS-safe invoker mode\n'
comment_start = '      - name: Prove COMMENT and DIRECT end-to-end with synthetic signed webhooks\n'
conversation_start = '      - name: Prove conversation grouping, confidence and P0 escalation with writes disabled\n'
subscriptions_start = '      - name: Configure and read back Meta COMMENT and DIRECT subscriptions\n'

for marker in [readiness_start, deploy_start, comment_start, conversation_start, subscriptions_start]:
    if workflow.count(marker) != 1:
        raise SystemExit(f'Expected exactly one marker: {marker.strip()}')

readiness_block = '''      - name: Run fail-closed readiness on PostgreSQL knowledge mirror
        shell: bash
        run: |
          set -euo pipefail
          JOB="toca-ig-eng-ready-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
          cleanup() {
            gcloud run jobs delete "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1 || true
          }
          trap cleanup EXIT

          DAEMON_JSON="$(gcloud run services describe "$DAEMON_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          DAEMON_URL="$(printf '%s' "$DAEMON_JSON" | jq -r '.status.url // empty')"
          test -n "$DAEMON_URL" || { echo 'Daemon URL missing before readiness' >&2; exit 1; }
          SCHEDULER_JSON="$(gcloud scheduler jobs describe "$SCHEDULER_JOB_NAME" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" --format=json)"
          printf '%s' "$SCHEDULER_JSON" | jq -e --arg uri "${DAEMON_URL}/tick" --arg sa "$GCP_RUNTIME_SERVICE_ACCOUNT" --arg audience "$DAEMON_URL" '
            (.httpTarget.uri == $uri) and
            (.httpTarget.httpMethod == "POST") and
            (.httpTarget.oidcToken.serviceAccountEmail == $sa) and
            (.httpTarget.oidcToken.audience == $audience)
          ' >/dev/null || { echo 'Scheduler target/OIDC boundary mismatch before readiness' >&2; exit 1; }

          gcloud run jobs deploy "$JOB" \\
            --image "$RUNTIME_IMAGE" \\
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \\
            --service-account "$GCP_RUNTIME_SERVICE_ACCOUNT" \\
            --set-cloudsql-instances "$CLOUD_SQL_INSTANCE" \\
            --set-secrets "DATABASE_URL=$DATABASE_SECRET_ID:latest" \\
            --set-env-vars "NODE_ENV=production,META_ENABLED=false,INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true,INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false,INSTAGRAM_ENGAGEMENT_TENANT_ID=$TOCA_TENANT_ID,INSTAGRAM_ENGAGEMENT_WORKSPACE_ID=$TOCA_WORKSPACE_ID,INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID=$TOCA_ORGANIZATION_ID,INSTAGRAM_ENGAGEMENT_PAGE_ID=$INSTAGRAM_PAGE_ID,INSTAGRAM_BUSINESS_ACCOUNT_ID=$INSTAGRAM_ACCOUNT_ID,INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID=$CANONICAL_FAQ_SPREADSHEET_ID,INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SOURCE=postgres" \\
            --command node --args dist/src/instagram-engagement-readiness-preflight.js \\
            --tasks 1 --max-retries 0 --task-timeout 180s --quiet
          gcloud run jobs execute "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --wait --quiet

          LOG_ENTRIES="$(gcloud logging read "resource.type=\\"cloud_run_job\\" AND resource.labels.job_name=\\"${JOB}\\"" --project "$GCP_PROJECT_ID" --freshness=20m --limit=200 --order=asc --format=json || true)"
          READINESS="$(printf '%s' "$LOG_ENTRIES" | node scripts/extract-instagram-engagement-cloud-run-evidence.mjs instagram-engagement-readiness)"
          printf '%s' "$READINESS" | jq -e '
            .status == "PASS" and
            .writesEnabled == false and
            .providerReadVerified == false and
            .databaseSchemaVerified == true and
            .migrationVerified == true and
            .conversationOperationsVerified == true and
            .knowledgeReadable == true and
            .knowledgeSchemaVerified == true and
            .knowledgeSnapshotVerified == true and
            .knowledgeAuthMode == "postgres" and
            .scopeConfigured == true and
            .identitiesPrinted == false and
            .secretsPrinted == false
          ' >/dev/null
          printf '%s' "$READINESS" | jq -c '{schemaVersion:"toca.instagram-engagement.shadow-readiness.v1",status,writesEnabled,knowledgeSource:.knowledgeAuthMode,databaseSchemaVerified,migrationVerified,conversationOperationsVerified,knowledgeSnapshotVerified,scopeConfigured,secretsPrinted,schedulerTargetVerified:true,schedulerOidcVerified:true}' \\
            > engagement-evidence/readiness.json

          cleanup
          trap - EXIT

'''

comment_block = '''      - name: Prove COMMENT and DIRECT end-to-end with synthetic signed webhooks
        env:
          WEBHOOK_URL: ${{ steps.deployed.outputs.webhook_url }}
        shell: bash
        run: |
          set -euo pipefail
          JOB="toca-ig-eng-shadow-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
          TICK_PID=''
          cleanup() {
            if [[ -n "$TICK_PID" ]]; then kill "$TICK_PID" >/dev/null 2>&1 || true; wait "$TICK_PID" >/dev/null 2>&1 || true; fi
            gcloud run jobs delete "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1 || true
          }
          trap cleanup EXIT

          DAEMON_ROUTED_JSON="$(gcloud run services describe "$DAEMON_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          WEBHOOK_ROUTED_JSON="$(gcloud run services describe "$WEBHOOK_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          printf '%s' "$DAEMON_ROUTED_JSON" | jq -e --arg revision "$DAEMON_CANDIDATE_REVISION" '([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision)' >/dev/null || { echo 'Exact daemon candidate must own 100% traffic immediately before COMMENT/DIRECT proof' >&2; exit 1; }
          printf '%s' "$WEBHOOK_ROUTED_JSON" | jq -e --arg revision "$WEBHOOK_CANDIDATE_REVISION" '([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision)' >/dev/null || { echo 'Exact webhook candidate must own 100% traffic immediately before COMMENT/DIRECT proof' >&2; exit 1; }

          DAEMON_URL="$(printf '%s' "$DAEMON_ROUTED_JSON" | jq -r '.status.url // empty')"
          test -n "$DAEMON_URL" || { echo 'Daemon URL missing before COMMENT/DIRECT proof' >&2; exit 1; }
          SCHEDULER_JSON="$(gcloud scheduler jobs describe "$SCHEDULER_JOB_NAME" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" --format=json)"
          printf '%s' "$SCHEDULER_JSON" | jq -e --arg uri "${DAEMON_URL}/tick" --arg sa "$GCP_RUNTIME_SERVICE_ACCOUNT" --arg audience "$DAEMON_URL" '
            (.httpTarget.uri == $uri) and
            (.httpTarget.httpMethod == "POST") and
            (.httpTarget.oidcToken.serviceAccountEmail == $sa) and
            (.httpTarget.oidcToken.audience == $audience)
          ' >/dev/null || { echo 'Scheduler target/OIDC boundary mismatch before COMMENT/DIRECT proof' >&2; exit 1; }

          gcloud run jobs deploy "$JOB" \\
            --image "$RUNTIME_IMAGE" \\
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \\
            --service-account "$GCP_RUNTIME_SERVICE_ACCOUNT" \\
            --set-cloudsql-instances "$CLOUD_SQL_INSTANCE" \\
            --set-secrets "DATABASE_URL=$DATABASE_SECRET_ID:latest,META_APP_SECRET=$META_APP_SECRET_ID:latest" \\
            --set-env-vars "NODE_ENV=production,INSTAGRAM_ENGAGEMENT_SHADOW_WEBHOOK_URL=$WEBHOOK_URL,INSTAGRAM_BUSINESS_ACCOUNT_ID=$INSTAGRAM_ACCOUNT_ID,INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false" \\
            --command node --args dist/src/ops/instagram-engagement-shadow-proof.js \\
            --tasks 1 --max-retries 0 --task-timeout 240s --quiet

          tick_pump() {
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

          PROOF="$(printf '%s' "$LOG_ENTRIES" | node scripts/extract-instagram-engagement-cloud-run-evidence.mjs instagram-engagement-shadow-e2e)"
          printf '%s' "$PROOF" | jq -e '
            .status == "PASS" and
            (.channelsVerified | sort == ["COMMENT","DIRECT"]) and
            .webhookAccepted == true and
            .inboundDelivered == true and
            .faqResolved == true and
            .externalReplyObserved == false and
            .replyOutboxEvents == 0 and
            .writesEnabled == false
          ' >/dev/null
          printf '%s\\n' "$PROOF" > engagement-evidence/shadow-proof.json

          cleanup
          trap - EXIT

'''

r0 = workflow.index(readiness_start)
r1 = workflow.index(deploy_start)
workflow = workflow[:r0] + readiness_block + workflow[r1:]

c0 = workflow.index(comment_start)
c1 = workflow.index(conversation_start)
workflow = workflow[:c0] + comment_block + workflow[c1:]

# Harden Conversation Operations cleanup so the scheduler pump cannot be orphaned.
conv0 = workflow.index(conversation_start)
conv1 = workflow.index(subscriptions_start)
conversation = workflow[conv0:conv1]
old_cleanup = '''          cleanup() {
            gcloud run jobs delete "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1 || true
          }
'''
new_cleanup = '''          cleanup() {
            if [[ -n "$TICK_PID" ]]; then kill "$TICK_PID" >/dev/null 2>&1 || true; wait "$TICK_PID" >/dev/null 2>&1 || true; fi
            gcloud run jobs delete "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1 || true
          }
'''
if conversation.count(old_cleanup) != 1:
    raise SystemExit('Expected one Conversation Operations cleanup block')
conversation = conversation.replace(old_cleanup, new_cleanup, 1)
workflow = workflow[:conv0] + conversation + workflow[conv1:]

workflow_path.write_text(workflow)

test_path = Path('test/instagram-engagement-production-shadow-ordering.test.ts')
test_path.write_text("""import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-production.yml',
  'utf8',
);

const readinessStart = workflow.indexOf(
  '      - name: Run fail-closed readiness on PostgreSQL knowledge mirror',
);
const deployStart = workflow.indexOf(
  '      - name: Deploy shadow runtime and expose webhook with DRS-safe invoker mode',
);
const commentStart = workflow.indexOf(
  '      - name: Prove COMMENT and DIRECT end-to-end with synthetic signed webhooks',
);
const conversationStart = workflow.indexOf(
  '      - name: Prove conversation grouping, confidence and P0 escalation with writes disabled',
);
const subscriptionsStart = workflow.indexOf(
  '      - name: Configure and read back Meta COMMENT and DIRECT subscriptions',
);

const readiness = workflow.slice(readinessStart, deployStart);
const commentProof = workflow.slice(commentStart, conversationStart);
const conversationProof = workflow.slice(conversationStart, subscriptionsStart);

describe('Instagram production shadow ordering regression', () => {
  it('keeps readiness independent from not-yet-created candidate revisions', () => {
    expect(readiness).not.toContain('DAEMON_CANDIDATE_REVISION');
    expect(readiness).not.toContain('WEBHOOK_CANDIDATE_REVISION');
    expect(readiness).not.toContain('tick_pump()');
    expect(readiness).not.toContain("TICK_PID=''");
    expect(readiness).toContain('instagram-engagement-readiness-preflight.js');
    expect(readiness).toContain('conversationOperationsVerified == true');
  });

  it('runs COMMENT/DIRECT proof only after exact candidate routing exists', () => {
    expect(commentStart).toBeGreaterThan(deployStart);
    expect(commentProof).toContain('DAEMON_CANDIDATE_REVISION');
    expect(commentProof).toContain('WEBHOOK_CANDIDATE_REVISION');
    expect(commentProof).toContain('tick_pump()');
    expect(commentProof).toContain('gcloud scheduler jobs run "$SCHEDULER_JOB_NAME"');
    expect(commentProof).toContain('oidcToken.serviceAccountEmail');
  });

  it('cleans up scheduler pumps in both shadow proof stages', () => {
    expect(commentProof).toContain('if [[ -n "$TICK_PID" ]]');
    expect(conversationProof).toContain('if [[ -n "$TICK_PID" ]]');
    expect(conversationProof).toContain('tick_pump()');
  });
});
""")
