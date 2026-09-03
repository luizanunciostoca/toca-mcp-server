from pathlib import Path

workflow_path = Path('.github/workflows/instagram-engagement-shadow-production.yml')
workflow = workflow_path.read_text()

old_sha = 'd23039fa360b1e1674964a59bd003ca76227e48f'
new_sha = 'bc9f02ff4663589c4f60fc585c89ca88b0369eba'
old_digest = 'sha256:4f7f9775fea909416341b18e0bc042fe0318037d6c1791fc7bcb4e121af24e30'
new_digest = 'sha256:4fdcea3fbc9e87f9790ca6cd6917176152104e840f6f37b31d680a42fa13b32a'

if old_sha not in workflow or old_digest not in workflow:
    raise SystemExit('old immutable runtime anchors missing')
workflow = workflow.replace(old_sha, new_sha).replace(old_digest, new_digest)

readiness_anchor = '''            .migrationVerified == true and
            .knowledgeReadable == true and'''
readiness_replacement = '''            .migrationVerified == true and
            .conversationOperationsVerified == true and
            .knowledgeReadable == true and'''
if readiness_anchor not in workflow:
    raise SystemExit('readiness assertion anchor missing')
workflow = workflow.replace(readiness_anchor, readiness_replacement, 1)

evidence_anchor = 'databaseSchemaVerified,migrationVerified,knowledgeSnapshotVerified,scopeConfigured,secretsPrinted}'
evidence_replacement = 'databaseSchemaVerified,migrationVerified,conversationOperationsVerified,knowledgeSnapshotVerified,scopeConfigured,secretsPrinted}'
if evidence_anchor not in workflow:
    raise SystemExit('readiness evidence projection anchor missing')
workflow = workflow.replace(evidence_anchor, evidence_replacement, 1)

subscription_anchor = '      - name: Configure and read back Meta COMMENT and DIRECT subscriptions\n'
if subscription_anchor not in workflow:
    raise SystemExit('subscription step anchor missing')

expr = '$' + '{{ steps.deployed.outputs.webhook_url }}'
conversation_step = f'''      - name: Prove conversation grouping, confidence and P0 escalation with writes disabled
        env:
          WEBHOOK_URL: {expr}
        shell: bash
        run: |
          set -euo pipefail
          JOB="toca-ig-conversation-shadow-${{GITHUB_RUN_ID}}-${{GITHUB_RUN_ATTEMPT}}"
          cleanup() {{
            gcloud run jobs delete "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1 || true
          }}
          trap cleanup EXIT

          gcloud run jobs deploy "$JOB" \\
            --image "$RUNTIME_IMAGE" \\
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \\
            --service-account "$GCP_RUNTIME_SERVICE_ACCOUNT" \\
            --set-cloudsql-instances "$CLOUD_SQL_INSTANCE" \\
            --set-secrets "DATABASE_URL=$DATABASE_SECRET_ID:latest,META_APP_SECRET=$META_APP_SECRET_ID:latest" \\
            --set-env-vars "NODE_ENV=production,INSTAGRAM_ENGAGEMENT_SHADOW_WEBHOOK_URL=$WEBHOOK_URL,INSTAGRAM_BUSINESS_ACCOUNT_ID=$INSTAGRAM_ACCOUNT_ID,INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false" \\
            --command node --args dist/src/ops/instagram-conversation-shadow-proof.js \\
            --tasks 1 --max-retries 0 --task-timeout 300s --quiet
          gcloud run jobs execute "$JOB" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --wait --quiet

          LOG_ENTRIES="$(gcloud logging read "resource.type=\\"cloud_run_job\\" AND resource.labels.job_name=\\"${{JOB}}\\"" --project "$GCP_PROJECT_ID" --freshness=20m --limit=300 --order=asc --format=json || true)"
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
workflow = workflow.replace(subscription_anchor, conversation_step + subscription_anchor, 1)

closeout_anchor = 'syntheticShadowProof:"PASS",externalReplyWritesEnabled:false'
closeout_replacement = 'syntheticShadowProof:"PASS",conversationShadowProof:"PASS",externalReplyWritesEnabled:false'
if closeout_anchor not in workflow:
    raise SystemExit('closeout anchor missing')
workflow = workflow.replace(closeout_anchor, closeout_replacement, 1)
workflow_path.write_text(workflow)

test_path = Path('test/instagram-engagement-shadow-drs-continuation.test.ts')
test = test_path.read_text()
if old_sha not in test or old_digest not in test:
    raise SystemExit('DRS runtime test anchors missing')
test_path.write_text(test.replace(old_sha, new_sha).replace(old_digest, new_digest))
