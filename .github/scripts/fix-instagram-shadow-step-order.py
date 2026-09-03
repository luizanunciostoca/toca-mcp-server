from pathlib import Path

workflow_path = Path('.github/workflows/instagram-engagement-shadow-production.yml')
test_path = Path('test/instagram-engagement-production-shadow-step-order.test.ts')
text = workflow_path.read_text()


def replace_between(source: str, start: str, end: str, replacement: str) -> str:
    start_index = source.index(start)
    end_index = source.index(end, start_index)
    return source[:start_index] + replacement + source[end_index:]

readiness = '''      - name: Run fail-closed readiness on PostgreSQL knowledge mirror
        shell: bash
        run: |
          set -euo pipefail
          JOB="toca-ig-eng-ready-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
          cleanup() {
            gcloud run jobs delete "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1 || true
          }
          trap cleanup EXIT

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
          printf '%s' "$READINESS" | jq -c '{schemaVersion:"toca.instagram-engagement.shadow-readiness.v1",status,writesEnabled,knowledgeSource:.knowledgeAuthMode,databaseSchemaVerified,migrationVerified,conversationOperationsVerified,knowledgeSnapshotVerified,scopeConfigured,secretsPrinted}' \\
            > engagement-evidence/readiness.json

          cleanup
          trap - EXIT

'''

comment_proof = '''      - name: Prove COMMENT and DIRECT end-to-end with synthetic signed webhooks
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
          printf '%s' "$DAEMON_ROUTED_JSON" | jq -e --arg revision "$DAEMON_CANDIDATE_REVISION" '([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision)' >/dev/null
          printf '%s' "$WEBHOOK_ROUTED_JSON" | jq -e --arg revision "$WEBHOOK_CANDIDATE_REVISION" '([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision)' >/dev/null

          DAEMON_URL="$(printf '%s' "$DAEMON_ROUTED_JSON" | jq -r '.status.url // empty')"
          SCHEDULER_JSON="$(gcloud scheduler jobs describe "$SCHEDULER_JOB_NAME" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" --format=json)"
          printf '%s' "$SCHEDULER_JSON" | jq -e --arg uri "${DAEMON_URL}/tick" --arg sa "$GCP_RUNTIME_SERVICE_ACCOUNT" --arg audience "$DAEMON_URL" '
            (.httpTarget.uri == $uri) and
            (.httpTarget.httpMethod == "POST") and
            (.httpTarget.oidcToken.serviceAccountEmail == $sa) and
            (.httpTarget.oidcToken.audience == $audience)
          ' >/dev/null || { echo 'Scheduler target/OIDC boundary mismatch' >&2; exit 1; }

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

conversation_proof = '''      - name: Prove conversation grouping, confidence and P0 escalation with writes disabled
        env:
          WEBHOOK_URL: ${{ steps.deployed.outputs.webhook_url }}
        shell: bash
        run: |
          set -euo pipefail
          JOB="toca-ig-conversation-shadow-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
          TICK_PID=''
          cleanup() {
            if [[ -n "$TICK_PID" ]]; then kill "$TICK_PID" >/dev/null 2>&1 || true; wait "$TICK_PID" >/dev/null 2>&1 || true; fi
            gcloud run jobs delete "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1 || true
          }
          trap cleanup EXIT

          DAEMON_ROUTED_JSON="$(gcloud run services describe "$DAEMON_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          WEBHOOK_ROUTED_JSON="$(gcloud run services describe "$WEBHOOK_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          printf '%s' "$DAEMON_ROUTED_JSON" | jq -e --arg revision "$DAEMON_CANDIDATE_REVISION" '([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision)' >/dev/null
          printf '%s' "$WEBHOOK_ROUTED_JSON" | jq -e --arg revision "$WEBHOOK_CANDIDATE_REVISION" '([.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | first == $revision)' >/dev/null

          DAEMON_URL="$(printf '%s' "$DAEMON_ROUTED_JSON" | jq -r '.status.url // empty')"
          SCHEDULER_JSON="$(gcloud scheduler jobs describe "$SCHEDULER_JOB_NAME" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" --format=json)"
          printf '%s' "$SCHEDULER_JSON" | jq -e --arg uri "${DAEMON_URL}/tick" --arg sa "$GCP_RUNTIME_SERVICE_ACCOUNT" --arg audience "$DAEMON_URL" '
            (.httpTarget.uri == $uri) and
            (.httpTarget.httpMethod == "POST") and
            (.httpTarget.oidcToken.serviceAccountEmail == $sa) and
            (.httpTarget.oidcToken.audience == $audience)
          ' >/dev/null || { echo 'Scheduler target/OIDC boundary mismatch' >&2; exit 1; }

          gcloud run jobs deploy "$JOB" \\
            --image "$RUNTIME_IMAGE" \\
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \\
            --service-account "$GCP_RUNTIME_SERVICE_ACCOUNT" \\
            --set-cloudsql-instances "$CLOUD_SQL_INSTANCE" \\
            --set-secrets "DATABASE_URL=$DATABASE_SECRET_ID:latest,META_APP_SECRET=$META_APP_SECRET_ID:latest" \\
            --set-env-vars "NODE_ENV=production,INSTAGRAM_ENGAGEMENT_SHADOW_WEBHOOK_URL=$WEBHOOK_URL,INSTAGRAM_BUSINESS_ACCOUNT_ID=$INSTAGRAM_ACCOUNT_ID,INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false" \\
            --command node --args dist/src/ops/instagram-conversation-shadow-proof.js \\
            --tasks 1 --max-retries 0 --task-timeout 300s --quiet

          tick_pump() {
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
          PROOF="$(printf '%s' "$LOG_ENTRIES" | node scripts/extract-instagram-engagement-cloud-run-evidence.mjs instagram-conversation-shadow-e2e)"
          printf '%s' "$PROOF" | jq -e '
            .status == "PASS" and
            .grouping.inboundEvents == 2 and
            .grouping.persistedGroups == 1 and
            .grouping.decisions == 1 and
            .grouping.messageCount == 2 and
            .lowConfidence.confidence == "LOW" and
            .lowConfidence.autoSendObserved == false and
            .p0.priority == "P0" and
            .p0.actionStatus == "HUMAN_REVIEW" and
            .p0.threadState == "ESCALATED" and
            .replyOutboxEvents == 0 and
            .externalReplyObserved == false and
            .writesEnabled == false and
            .messageTextPrinted == false and
            .userIdentityPrinted == false and
            .secretsPrinted == false
          ' >/dev/null
          printf '%s\\n' "$PROOF" > engagement-evidence/conversation-shadow-proof.json

          cleanup
          trap - EXIT

'''

text = replace_between(text, '      - name: Run fail-closed readiness on PostgreSQL knowledge mirror\n', '      - name: Deploy shadow runtime and expose webhook with DRS-safe invoker mode\n', readiness)
text = replace_between(text, '      - name: Prove COMMENT and DIRECT end-to-end with synthetic signed webhooks\n', '      - name: Prove conversation grouping, confidence and P0 escalation with writes disabled\n', comment_proof)
text = replace_between(text, '      - name: Prove conversation grouping, confidence and P0 escalation with writes disabled\n', '      - name: Configure and read back Meta COMMENT and DIRECT subscriptions\n', conversation_proof)
workflow_path.write_text(text)

test_path.write_text('''import { readFileSync } from 'node:fs';\nimport { describe, expect, it } from 'vitest';\n\nconst workflow = readFileSync(\n  '.github/workflows/instagram-engagement-shadow-production.yml',\n  'utf8',\n);\n\nfunction section(start: string, end: string): string {\n  const startIndex = workflow.indexOf(start);\n  const endIndex = workflow.indexOf(end, startIndex);\n  expect(startIndex).toBeGreaterThanOrEqual(0);\n  expect(endIndex).toBeGreaterThan(startIndex);\n  return workflow.slice(startIndex, endIndex);\n}\n\ndescribe('Instagram production shadow step ordering', () => {\n  it('keeps readiness independent from candidate routing and tick pumps', () => {\n    const readiness = section(\n      '- name: Run fail-closed readiness on PostgreSQL knowledge mirror',\n      '- name: Deploy shadow runtime and expose webhook with DRS-safe invoker mode',\n    );\n\n    expect(readiness).toContain('instagram-engagement-readiness-preflight.js');\n    expect(readiness).toContain('conversationOperationsVerified == true');\n    expect(readiness).not.toContain('DAEMON_CANDIDATE_REVISION');\n    expect(readiness).not.toContain('WEBHOOK_CANDIDATE_REVISION');\n    expect(readiness).not.toContain('TICK_PID');\n    expect(readiness).not.toContain('tick_pump');\n  });\n\n  it('creates and routes exact candidates only after readiness', () => {\n    const deploy = section(\n      '- name: Deploy shadow runtime and expose webhook with DRS-safe invoker mode',\n      '- name: Verify DRS-safe public callback and fail-closed writes',\n    );\n\n    expect(deploy).toContain('EXPECTED_DAEMON_CANDIDATE_REVISION');\n    expect(deploy).toContain('EXPECTED_WEBHOOK_CANDIDATE_REVISION');\n    expect(deploy).toContain('--to-revisions="${EXPECTED_DAEMON_CANDIDATE_REVISION}=100"');\n    expect(deploy).toContain('--to-revisions="${EXPECTED_WEBHOOK_CANDIDATE_REVISION}=100"');\n    expect(deploy).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');\n  });\n\n  it('requires exact candidate traffic and authenticated tick pump in COMMENT/DIRECT proof', () => {\n    const proof = section(\n      '- name: Prove COMMENT and DIRECT end-to-end with synthetic signed webhooks',\n      '- name: Prove conversation grouping, confidence and P0 escalation with writes disabled',\n    );\n\n    expect(proof).toContain('DAEMON_CANDIDATE_REVISION');\n    expect(proof).toContain('WEBHOOK_CANDIDATE_REVISION');\n    expect(proof).toContain('tick_pump()');\n    expect(proof).toContain('gcloud scheduler jobs run "$SCHEDULER_JOB_NAME"');\n    expect(proof).toContain('TICK_PID=');\n    expect(proof).toContain('replyOutboxEvents == 0');\n    expect(proof).toContain('externalReplyObserved == false');\n  });\n\n  it('requires exact candidate traffic and safe tick cleanup in Conversation Operations proof', () => {\n    const proof = section(\n      '- name: Prove conversation grouping, confidence and P0 escalation with writes disabled',\n      '- name: Configure and read back Meta COMMENT and DIRECT subscriptions',\n    );\n\n    expect(proof).toContain('DAEMON_CANDIDATE_REVISION');\n    expect(proof).toContain('WEBHOOK_CANDIDATE_REVISION');\n    expect(proof).toContain('tick_pump()');\n    expect(proof).toContain('if [[ -n "$TICK_PID" ]]');\n    expect(proof).toContain('.lowConfidence.autoSendObserved == false');\n    expect(proof).toContain('.p0.threadState == "ESCALATED"');\n    expect(proof).toContain('.replyOutboxEvents == 0');\n  });\n});\n''')
