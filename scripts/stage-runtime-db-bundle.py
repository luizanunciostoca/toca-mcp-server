from pathlib import Path

workflow_path = Path('.github/workflows/deploy-gcp.yml')
workflow = workflow_path.read_text()

start = workflow.index(
    '      - name: Start verified Cloud SQL Auth Proxy for repository database operations'
)
runtime_config = workflow.index(
    '      - name: Build non-secret runtime configuration and Secret Manager bindings', start
)
configure = workflow.index('      - name: Configure Docker auth', start)
build_section = workflow[configure:runtime_config]

migration_job = r'''      - name: Apply repository migrations through runtime identity job
        if: inputs.operation == 'deploy'
        run: |
          set -euo pipefail
          JOB_NAME="toca-db-migrate-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
          cleanup() {
            set +e
            gcloud run jobs delete "$JOB_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1
            REMAINING_CLEANUP="$(gcloud run jobs list --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --filter="metadata.name=${JOB_NAME}" --format='value(metadata.name)' 2>/dev/null)"
            if [[ -n "$REMAINING_CLEANUP" ]]; then
              echo "Database migration cleanup could not prove job absence: $JOB_NAME" >&2
            else
              echo 'DATABASE_MIGRATION_JOB_CLEANUP=PASS'
            fi
            set -e
          }
          trap cleanup EXIT

          gcloud run jobs deploy "$JOB_NAME" \
            --image "$IMAGE" \
            --project "$GCP_PROJECT_ID" \
            --region "$GCP_REGION" \
            --service-account "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT" \
            --set-cloudsql-instances "${GCP_PROJECT_ID}:${GCP_REGION}:${GCP_CLOUD_SQL_INSTANCE}" \
            --set-secrets "DATABASE_URL=${GCP_DATABASE_URL_SECRET}:${GCP_DATABASE_URL_SECRET_VERSION}" \
            --set-env-vars "DATABASE_SSL=false" \
            --command node \
            --args dist/scripts/migrate.js \
            --tasks 1 \
            --max-retries 0 \
            --task-timeout 300s \
            --quiet
          gcloud run jobs execute "$JOB_NAME" \
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --wait --quiet

          mkdir -p platform-evidence
          jq -n \
            --arg job "$JOB_NAME" --arg image "$IMAGE" \
            --arg serviceAccount "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT" \
            --arg secret "$GCP_DATABASE_URL_SECRET" --arg secretVersion "$GCP_DATABASE_URL_SECRET_VERSION" \
            --arg cloudSql "${GCP_PROJECT_ID}:${GCP_REGION}:${GCP_CLOUD_SQL_INSTANCE}" \
            '{schemaVersion:"toca.platform.database-migration-job.v1",job:$job,image:$image,serviceAccount:$serviceAccount,databaseSecretId:$secret,databaseSecretVersion:$secretVersion,cloudSqlInstance:$cloudSql,secretPayloadDisclosed:false,providerCallExecuted:false,result:"PASS"}' \
            > platform-evidence/database-migration-job.json

          cleanup
          trap - EXIT
          REMAINING="$(gcloud run jobs list --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --filter="metadata.name=${JOB_NAME}" --format='value(metadata.name)')"
          [[ -z "$REMAINING" ]] || { echo "Database migration job still exists after cleanup: $JOB_NAME" >&2; exit 1; }

'''
workflow = workflow[:start] + build_section + migration_job + workflow[runtime_config:]

evidence_start = workflow.index(
    '      - name: Capture database Audit Outbox Workflow Privacy and migration refs through authenticated proxy'
)
evidence_end = workflow.index(
    '      - name: Capture non-secret deploy and provider evidence', evidence_start
)
evidence_job = r'''      - name: Capture database Audit Outbox Workflow Privacy and migration refs through runtime identity job
        if: inputs.operation == 'deploy'
        run: |
          set -euo pipefail
          JOB_NAME="toca-db-evidence-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
          cleanup() {
            set +e
            gcloud run jobs delete "$JOB_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1
            REMAINING_CLEANUP="$(gcloud run jobs list --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --filter="metadata.name=${JOB_NAME}" --format='value(metadata.name)' 2>/dev/null)"
            if [[ -n "$REMAINING_CLEANUP" ]]; then
              echo "Database evidence cleanup could not prove job absence: $JOB_NAME" >&2
            else
              echo 'DATABASE_EVIDENCE_JOB_CLEANUP=PASS'
            fi
            set -e
          }
          trap cleanup EXIT

          gcloud run jobs deploy "$JOB_NAME" \
            --image "$IMAGE" \
            --project "$GCP_PROJECT_ID" \
            --region "$GCP_REGION" \
            --service-account "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT" \
            --set-cloudsql-instances "${GCP_PROJECT_ID}:${GCP_REGION}:${GCP_CLOUD_SQL_INSTANCE}" \
            --set-secrets "DATABASE_URL=${GCP_DATABASE_URL_SECRET}:${GCP_DATABASE_URL_SECRET_VERSION}" \
            --set-env-vars "DATABASE_SSL=false,TOCA_RELEASE_SHA=${GITHUB_SHA},TOCA_DEPLOY_ENVIRONMENT=${DEPLOY_ENVIRONMENT}" \
            --command node \
            --args scripts/capture-platform-evidence.mjs,- \
            --tasks 1 \
            --max-retries 0 \
            --task-timeout 180s \
            --quiet
          gcloud run jobs execute "$JOB_NAME" \
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --wait --quiet

          LOGS="$(gcloud logging read \
            "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${JOB_NAME}\"" \
            --project "$GCP_PROJECT_ID" --freshness=10m --limit=200 --order=asc \
            --format='value(textPayload)' || true)"
          EVIDENCE_B64="$(printf '%s\n' "$LOGS" | sed -n 's/.*PLATFORM_EVIDENCE_BASE64=\([A-Za-z0-9+\/=]*\).*/\1/p' | tail -n1)"
          [[ -n "$EVIDENCE_B64" ]] || { echo 'Database evidence payload marker was not found' >&2; exit 1; }
          mkdir -p platform-evidence
          printf '%s' "$EVIDENCE_B64" | base64 --decode > platform-evidence/database-runtime.json
          jq -e --arg sha "$GITHUB_SHA" --arg environment "$DEPLOY_ENVIRONMENT" '
            .schemaVersion == "toca.platform.evidence.database-runtime.v2" and
            .releaseSha == $sha and
            .environment == $environment
          ' platform-evidence/database-runtime.json >/dev/null
          jq -n \
            --arg job "$JOB_NAME" --arg image "$IMAGE" \
            --arg serviceAccount "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT" \
            --arg secret "$GCP_DATABASE_URL_SECRET" --arg secretVersion "$GCP_DATABASE_URL_SECRET_VERSION" \
            '{schemaVersion:"toca.platform.database-evidence-job.v1",job:$job,image:$image,serviceAccount:$serviceAccount,databaseSecretId:$secret,databaseSecretVersion:$secretVersion,secretPayloadDisclosed:false,providerCallExecuted:false,result:"PASS"}' \
            > platform-evidence/database-evidence-job.json

          cleanup
          trap - EXIT
          REMAINING="$(gcloud run jobs list --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --filter="metadata.name=${JOB_NAME}" --format='value(metadata.name)')"
          [[ -z "$REMAINING" ]] || { echo "Database evidence job still exists after cleanup: $JOB_NAME" >&2; exit 1; }

'''
workflow = workflow[:evidence_start] + evidence_job + workflow[evidence_end:]
workflow_path.write_text(workflow)
