#!/usr/bin/env bash
set -euo pipefail

required=(GCP_PROJECT_ID GCP_REGION WEBHOOK_SERVICE_NAME)
for name in "${required[@]}"; do
  value="${!name:-}"
  [[ -n "$value" ]] || {
    echo "INSTAGRAM_WEBHOOK_CALLBACK_REQUIRED_ENV_MISSING:$name" >&2
    exit 64
  }
done

SERVICE_JSON="$(gcloud run services describe "$WEBHOOK_SERVICE_NAME" \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
IAM_JSON="$(gcloud run services get-iam-policy "$WEBHOOK_SERVICE_NAME" \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"

INGRESS="$(jq -r '.metadata.annotations["run.googleapis.com/ingress"] // "all"' <<<"$SERVICE_JSON")"
DEFAULT_URL_DISABLED="$(jq -r '.metadata.annotations["run.googleapis.com/default-url-disabled"] // "false"' <<<"$SERVICE_JSON")"
INVOKER_IAM_DISABLED="$(jq -r '.metadata.annotations["run.googleapis.com/invoker-iam-disabled"] // "false"' <<<"$SERVICE_JSON")"
WEBHOOK_URL="$(jq -r '.status.url // empty' <<<"$SERVICE_JSON")"
ROUTED_REVISION="$(jq -r '
  [.status.traffic[]? | select((.percent // 0) == 100 and (.revisionName // "") != "") | .revisionName]
  | unique
  | if length == 1 then .[0] else empty end
' <<<"$SERVICE_JSON")"

[[ "$INGRESS" == 'all' ]] || {
  echo "INSTAGRAM_WEBHOOK_CALLBACK_INGRESS_RESTRICTED:$INGRESS" >&2
  exit 1
}
[[ "$DEFAULT_URL_DISABLED" == 'false' ]] || {
  echo 'INSTAGRAM_WEBHOOK_CALLBACK_DEFAULT_URL_DISABLED' >&2
  exit 1
}
[[ "$INVOKER_IAM_DISABLED" == 'true' ]] || {
  echo 'INSTAGRAM_WEBHOOK_CALLBACK_INVOKER_IAM_CHECK_ENABLED' >&2
  exit 1
}
[[ -n "$WEBHOOK_URL" && -n "$ROUTED_REVISION" ]] || {
  echo 'INSTAGRAM_WEBHOOK_CALLBACK_URL_OR_REVISION_MISSING' >&2
  exit 1
}
if jq -e '
  .bindings[]?
  | select(.role == "roles/run.invoker")
  | (.members // [])[]?
  | select(. == "allUsers")
' <<<"$IAM_JSON" >/dev/null; then
  echo 'INSTAGRAM_WEBHOOK_CALLBACK_LEGACY_ALLUSERS_FORBIDDEN' >&2
  exit 1
fi

REVISION_JSON="$(gcloud run revisions describe "$ROUTED_REVISION" \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
jq -e '
  .spec.containers[0] as $c |
  def envValue($name): ([($c.env // [])[] | select(.name == $name) | .value] | last // null);
  (([.status.conditions[]? | select(.type == "Ready") | .status] | last) == "True") and
  (envValue("TOCA_SERVICE_ROLE") == "webhook") and
  (envValue("MCP_ENABLED") == "false") and
  (envValue("META_WEBHOOK_ENABLED") == "true") and
  (envValue("META_WEBHOOK_PERSISTENCE_ENABLED") == "true") and
  (envValue("INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED") == "true") and
  ((envValue("INSTAGRAM_ENGAGEMENT_WRITES_ENABLED") // "false") == "false")
' <<<"$REVISION_JSON" >/dev/null || {
  echo 'INSTAGRAM_WEBHOOK_CALLBACK_RUNTIME_CONTRACT_INVALID' >&2
  exit 1
}

bounded_status() {
  local url="$1"
  local output="$2"
  local attempt status
  for attempt in 1 2 3 4; do
    status="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
      --output "$output" --write-out '%{http_code}' "$url" || true)"
    if [[ "$status" =~ ^[0-9]{3}$ ]]; then
      printf '%s' "$status"
      return 0
    fi
    [[ "$attempt" == 4 ]] || sleep 3
  done
  return 1
}

HEALTH_FILE="${RUNNER_TEMP:-$HOME}/instagram-webhook-health.json"
READY_FILE="${RUNNER_TEMP:-$HOME}/instagram-webhook-ready.json"
INVALID_FILE="${RUNNER_TEMP:-$HOME}/instagram-webhook-invalid-challenge.json"

HEALTH_STATUS="$(bounded_status "$WEBHOOK_URL/healthz" "$HEALTH_FILE")"
READY_STATUS="$(bounded_status "$WEBHOOK_URL/readyz" "$READY_FILE")"
INVALID_STATUS="$(bounded_status "$WEBHOOK_URL/webhooks/meta?hub.mode=subscribe&hub.verify_token=invalid-token&hub.challenge=must-not-pass" "$INVALID_FILE")"

[[ "$HEALTH_STATUS" == '200' ]] || {
  echo "INSTAGRAM_WEBHOOK_CALLBACK_HEALTH_FAILED:HTTP_$HEALTH_STATUS" >&2
  exit 1
}
[[ "$READY_STATUS" == '200' ]] || {
  echo "INSTAGRAM_WEBHOOK_CALLBACK_READY_FAILED:HTTP_$READY_STATUS" >&2
  exit 1
}
[[ "$INVALID_STATUS" == '403' ]] || {
  echo "INSTAGRAM_WEBHOOK_CALLBACK_INVALID_CHALLENGE_UNEXPECTED:HTTP_$INVALID_STATUS" >&2
  exit 1
}
grep -q '"error":"meta_webhook_verification_rejected"' "$INVALID_FILE" || {
  echo 'INSTAGRAM_WEBHOOK_CALLBACK_INVALID_CHALLENGE_BODY_MISMATCH' >&2
  exit 1
}

echo 'INSTAGRAM_WEBHOOK_CALLBACK_SURFACE=PASS'
echo "SERVING_REVISION=$ROUTED_REVISION"
echo 'INGRESS=all'
echo 'DEFAULT_URL_DISABLED=false'
echo 'INVOKER_IAM_DISABLED=true'
echo 'LEGACY_ALLUSERS_INVOKER=false'
echo 'HEALTH_HTTP_STATUS=200'
echo 'READY_HTTP_STATUS=200'
echo 'INVALID_CHALLENGE_HTTP_STATUS=403'
echo 'DATABASE_SCHEMA_READINESS=PASS'
echo 'PROVIDER_WRITES=false'
echo 'DATABASE_MUTATIONS=false'
