#!/usr/bin/env bash
set -euo pipefail

: "${GCP_PROJECT_ID:?}"
: "${GCP_REGION:?}"
: "${GCP_ARTIFACT_REPOSITORY:?}"
: "${GCP_RUNTIME_SERVICE_ACCOUNT:?}"
: "${TOKEN_SECRET_ID:?}"
: "${DATABASE_SECRET_ID:?}"
: "${CLOUD_SQL_INSTANCE:?}"
: "${META_APP_ID:?}"
: "${META_REDIRECT_URI:?}"
: "${GITHUB_SHA:?}"
: "${GITHUB_RUN_ID:?}"
: "${GITHUB_RUN_ATTEMPT:?}"

IMAGE="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/$GCP_ARTIFACT_REPOSITORY/server:meta-ads-itacare-rebalance-$GITHUB_SHA"
JOB_NAME="toca-meta-ads-itacare-rebalance-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"

cleanup() {
  gcloud run jobs delete "$JOB_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet || true
}
trap cleanup EXIT

gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev" --quiet
docker build -t "$IMAGE" .
docker push "$IMAGE"

gcloud run jobs deploy "$JOB_NAME"   --image "$IMAGE"   --project "$GCP_PROJECT_ID"   --region "$GCP_REGION"   --service-account "$GCP_RUNTIME_SERVICE_ACCOUNT"   --set-secrets "TOCA_SECRET_META_ACCESS_TOKEN=$TOKEN_SECRET_ID:latest"   --command node   --args dist/src/meta-ads-itacare-rebalance-plus-1000-2026-09-25.js   --set-env-vars "^~^NODE_ENV=production~MCP_ENABLED=false~META_ENABLED=true~META_ADS_READ_ENABLED=true~META_ADS_WRITE_ENABLED=true~META_ACCESS_TOKEN_ENV_KEY=TOCA_SECRET_META_ACCESS_TOKEN~META_ADS_ALLOWED_ACCOUNT_ID=311793958882290~META_ADS_ALLOWED_CURRENCY=BRL~META_ADS_MAX_DAILY_BUDGET_MINOR=100000~META_ADS_ALLOWED_GEO_KEYS=ITACARE,ILHEUS,ITABUNA,VITORIA_DA_CONQUISTA~META_ADS_ALLOWED_PIXEL_ID=461233076843065~META_ADS_ALLOWED_PAGE_ID=306103746115875~META_ADS_ALLOWED_INSTAGRAM_ACTOR_ID=17841402033495654~META_ADS_APPROVED_REQUEST_SHA256=85e625ae664a9b145be3aea11fc3934d83393043615984e3c279a8bb5e8bfc7f~META_APP_ID=$META_APP_ID~META_APP_SECRET_PROVIDER=env~META_APP_SECRET_KEY=UNUSED_META_APP_SECRET~META_AUTHORIZATION_ENDPOINT=https://www.facebook.com/dialog/oauth~META_TOKEN_ENDPOINT=https://graph.facebook.com/oauth/access_token~META_REDIRECT_URI=$META_REDIRECT_URI~META_REQUESTED_SCOPES=ads_read,ads_management,business_management~META_GRAPH_BASE_URL=https://graph.facebook.com~META_GRAPH_API_VERSION=v24.0~META_TOKEN_STORE_PROVIDER=gcp-secret-manager~META_TOKEN_SECRET_ID=$TOKEN_SECRET_ID~GCP_PROJECT_ID=$GCP_PROJECT_ID~META_ADS_ITACARE_REBALANCE_APPROVAL=APPROVED_ITACARE_REBALANCE_PLUS_1000_20260925"   --tasks 1 --max-retries 0 --task-timeout 300s --quiet

set +e
gcloud run jobs execute "$JOB_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --wait --quiet
EXECUTE_RC=$?
set -e
if [ "$EXECUTE_RC" -ne 0 ]; then
  echo "META_ADS_ITACARE_REBALANCE_EXECUTE_FAILED=$EXECUTE_RC"
  gcloud logging read \
    "resource.type=cloud_run_job AND resource.labels.job_name=${JOB_NAME}" \
    --project "$GCP_PROJECT_ID" \
    --freshness=20m \
    --limit=160 \
    --order=desc \
    --format='value(textPayload)' \
    | grep -E 'META_ADS_ITACARE_REBALANCE|META_HTTP_|META_CODE_|META_REASON_|Error|Exception|FAILED' \
    | head -n 140 || true
  exit "$EXECUTE_RC"
fi

RESULT_JSON=''
for attempt in $(seq 1 18); do
  LINE="$(gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=${JOB_NAME} AND textPayload:\"META_ADS_ITACARE_REBALANCE_RESULT=\"" --project "$GCP_PROJECT_ID" --freshness=20m --limit=100 --order=desc --format='value(textPayload)' | grep 'META_ADS_ITACARE_REBALANCE_RESULT=' | head -n1 || true)"
  if [ -n "$LINE" ]; then RESULT_JSON="${LINE#META_ADS_ITACARE_REBALANCE_RESULT=}"; break; fi
  sleep 5
done

test -n "$RESULT_JSON"
printf '%s' "$RESULT_JSON" | jq -e '
  .status == "REBALANCED_AND_ACTIVATED" and
  .providerMutationExecuted == true and
  .approvedIncrementMinor == 100000 and
  .newChallengerBudgetMinor == 80000 and
  .broadItabunaAdditionalMinor == 20000 and
  (.activeNewAds | length == 15)
' >/dev/null
printf '%s\n' "$RESULT_JSON" | jq . > meta-ads-itacare-rebalance-plus-1000.json
