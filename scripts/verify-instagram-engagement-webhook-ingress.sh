#!/usr/bin/env bash
set -euo pipefail

required=(
  GCP_PROJECT_ID GCP_REGION GCP_RUNTIME_SERVICE_ACCOUNT CLOUD_SQL_INSTANCE
  DATABASE_SECRET_ID TOKEN_SECRET_ID META_APP_SECRET_ID RUNTIME_IMAGE
  WEBHOOK_SERVICE_NAME META_APP_ID INSTAGRAM_PAGE_ID INSTAGRAM_ACCOUNT_ID
)
for name in "${required[@]}"; do
  value="${!name:-}"
  [[ -n "$value" ]] || {
    echo "INSTAGRAM_WEBHOOK_INGRESS_REQUIRED_ENV_MISSING:$name" >&2
    exit 64
  }
done

WEBHOOK_JSON="$(gcloud run services describe "$WEBHOOK_SERVICE_NAME" \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
WEBHOOK_URL="$(jq -r '.status.url // empty' <<<"$WEBHOOK_JSON")"
[[ -n "$WEBHOOK_URL" ]] || {
  echo 'INSTAGRAM_WEBHOOK_INGRESS_STATUS_URL_MISSING' >&2
  exit 1
}

DEFAULT_URL_DISABLED="$(jq -r '.metadata.annotations["run.googleapis.com/default-url-disabled"] // "false"' <<<"$WEBHOOK_JSON")"
INVOKER_IAM_DISABLED="$(jq -r '.metadata.annotations["run.googleapis.com/invoker-iam-disabled"] // "false"' <<<"$WEBHOOK_JSON")"
[[ "$DEFAULT_URL_DISABLED" != 'true' ]] || {
  echo 'INSTAGRAM_WEBHOOK_INGRESS_DEFAULT_URL_DISABLED' >&2
  exit 1
}
[[ "$INVOKER_IAM_DISABLED" == 'true' ]] || {
  echo 'INSTAGRAM_WEBHOOK_INGRESS_INVOKER_IAM_CHECK_ENABLED' >&2
  exit 1
}

ROUTED_REVISION="$(jq -r '
  [.status.traffic[]? | select((.percent // 0) == 100 and (.revisionName // "") != "") | .revisionName]
  | unique
  | if length == 1 then .[0] else empty end
' <<<"$WEBHOOK_JSON")"
[[ -n "$ROUTED_REVISION" ]] || {
  echo 'INSTAGRAM_WEBHOOK_INGRESS_EXACT_TRAFFIC_REVISION_REQUIRED' >&2
  exit 1
}

REVISION_JSON="$(gcloud run revisions describe "$ROUTED_REVISION" \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"

jq -e \
  --arg runtime "$GCP_RUNTIME_SERVICE_ACCOUNT" \
  --arg cloudSql "$CLOUD_SQL_INSTANCE" '
  .spec.containers[0] as $c |
  def envValue($name): ([($c.env // [])[] | select(.name == $name) | .value] | last // null);
  (([.status.conditions[]? | select(.type == "Ready") | .status] | last) == "True") and
  (.spec.serviceAccountName == $runtime) and
  ($c.command == ["node"]) and
  ($c.args == ["dist/src/http-instagram-engagement.js"]) and
  (envValue("TOCA_SERVICE_ROLE") == "webhook") and
  (envValue("MCP_ENABLED") == "false") and
  (envValue("META_WEBHOOK_ENABLED") == "true") and
  (envValue("META_WEBHOOK_PERSISTENCE_ENABLED") == "true") and
  (envValue("INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED") == "true") and
  ((envValue("INSTAGRAM_ENGAGEMENT_WRITES_ENABLED") // "false") == "false") and
  ([.. | strings] | any(contains($cloudSql))) and
  ([.. | objects | select(.name? == "DATABASE_URL") | .valueFrom? | select(. != null)] | length > 0)
' <<<"$REVISION_JSON" >/dev/null || {
  echo 'INSTAGRAM_WEBHOOK_INGRESS_RUNTIME_CONTRACT_INVALID' >&2
  exit 1
}

IAM_JSON="$(gcloud run services get-iam-policy "$WEBHOOK_SERVICE_NAME" \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
if jq -e '
  .bindings[]?
  | select(.role == "roles/run.invoker")
  | (.members // [])[]?
  | select(. == "allUsers")
' <<<"$IAM_JSON" >/dev/null; then
  echo 'INSTAGRAM_WEBHOOK_INGRESS_LEGACY_ALLUSERS_FORBIDDEN' >&2
  exit 1
fi

JOB="toca-ig-ingress-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}"
cleanup() {
  set +e
  gcloud run jobs delete "$JOB" \
    --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1
  set -e
}
trap cleanup EXIT

gcloud run jobs deploy "$JOB" \
  --image "$RUNTIME_IMAGE" \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
  --service-account "$GCP_RUNTIME_SERVICE_ACCOUNT" \
  --set-cloudsql-instances "$CLOUD_SQL_INSTANCE" \
  --set-secrets "DATABASE_URL=$DATABASE_SECRET_ID:latest,META_APP_SECRET=$META_APP_SECRET_ID:latest,META_ACCESS_TOKEN=$TOKEN_SECRET_ID:latest" \
  --set-env-vars "^#^INSTAGRAM_ENGAGEMENT_WEBHOOK_URL=$WEBHOOK_URL#META_APP_ID=$META_APP_ID#INSTAGRAM_ENGAGEMENT_PAGE_ID=$INSTAGRAM_PAGE_ID#INSTAGRAM_BUSINESS_ACCOUNT_ID=$INSTAGRAM_ACCOUNT_ID#META_GRAPH_BASE_URL=https://graph.facebook.com#META_GRAPH_API_VERSION=v24.0" \
  --command node \
  --args dist/src/ops/instagram-engagement-ingestion-health-readonly.js \
  --tasks 1 --max-retries 0 --task-timeout 120s --quiet

gcloud run jobs execute "$JOB" \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --wait --quiet

SAFE_LINES=''
for attempt in 1 2 3 4 5 6; do
  LOGS="$(gcloud logging read \
    "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$JOB\"" \
    --project "$GCP_PROJECT_ID" --freshness=15m --limit=300 --order=desc --format=json 2>/dev/null || printf '[]')"
  SAFE_LINES="$(jq -r '.[] | (.textPayload // .jsonPayload.message // empty)' <<<"$LOGS" \
    | grep -E '^(INSTAGRAM_ENGAGEMENT_INGESTION_HEALTH_READONLY|SUBSCRIPTION_MODEL|DATABASE_READ_PASS|PROVIDER_READ_PASS|APP_INSTAGRAM_SUBSCRIPTION_PRESENT|APP_CALLBACK_URL_MATCH|APP_COMMENTS_FIELD_PRESENT|APP_MESSAGES_FIELD_PRESENT|PAGE_APP_SUBSCRIPTION_PRESENT|PAGE_MESSAGES_FIELD_PRESENT|CALLBACK_CHALLENGE_PASS|DATABASE_MUTATIONS|PROVIDER_METHODS|PROVIDER_WRITES|PERSISTENT_SERVICE_MUTATIONS|EXTERNAL_REPLY_WRITES|RAW_USER_DATA_LOGGED|SECRETS_PRINTED)=' \
    || true)"
  if grep -Fxq 'INSTAGRAM_ENGAGEMENT_INGESTION_HEALTH_READONLY=PASS' <<<"$SAFE_LINES"; then
    break
  fi
  [[ "$attempt" == 6 ]] || sleep 5
done

required_markers=(
  'INSTAGRAM_ENGAGEMENT_INGESTION_HEALTH_READONLY=PASS'
  'SUBSCRIPTION_MODEL=FACEBOOK_LOGIN_PAGE_BOUND'
  'DATABASE_READ_PASS=true'
  'PROVIDER_READ_PASS=true'
  'APP_INSTAGRAM_SUBSCRIPTION_PRESENT=true'
  'APP_CALLBACK_URL_MATCH=true'
  'APP_COMMENTS_FIELD_PRESENT=true'
  'APP_MESSAGES_FIELD_PRESENT=true'
  'PAGE_APP_SUBSCRIPTION_PRESENT=true'
  'PAGE_MESSAGES_FIELD_PRESENT=true'
  'CALLBACK_CHALLENGE_PASS=true'
  'DATABASE_MUTATIONS=false'
  'PROVIDER_METHODS=GET_ONLY'
  'PROVIDER_WRITES=false'
  'PERSISTENT_SERVICE_MUTATIONS=false'
  'EXTERNAL_REPLY_WRITES=false'
  'RAW_USER_DATA_LOGGED=false'
  'SECRETS_PRINTED=false'
)
for marker in "${required_markers[@]}"; do
  grep -Fxq "$marker" <<<"$SAFE_LINES" || {
    echo "INSTAGRAM_WEBHOOK_INGRESS_HEALTH_MARKER_MISSING:$marker" >&2
    exit 1
  }
done

cleanup
trap - EXIT
REMAINING="$(gcloud run jobs list \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
  --filter="metadata.name=$JOB" --format='value(metadata.name)')"
[[ -z "$REMAINING" ]] || {
  echo 'INSTAGRAM_WEBHOOK_INGRESS_DIAGNOSTIC_CLEANUP_FAILED' >&2
  exit 1
}

echo 'INSTAGRAM_ENGAGEMENT_WEBHOOK_INGRESS=PASS'
echo "INSTAGRAM_ENGAGEMENT_WEBHOOK_REVISION=$ROUTED_REVISION"
echo 'ENGAGEMENT_RUNTIME_ENABLED=true'
echo 'CALLBACK_PUBLIC_DRS_SAFE=true'
echo 'PROVIDER_SUBSCRIPTIONS_VERIFIED=true'
echo 'PERSISTENCE_READINESS_VERIFIED=true'
echo 'CALLBACK_CHALLENGE_PASS=true'
echo 'PROVIDER_WRITES=false'
echo 'DATABASE_MUTATIONS=false'
echo 'TRAFFIC_MUTATIONS=false'
echo 'RAW_SECRET_LOGGED=false'
