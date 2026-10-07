#!/usr/bin/env bash
set -euo pipefail

required=(GCP_PROJECT_ID GCP_REGION WEBHOOK_SERVICE_NAME META_APP_SECRET_ID)
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

jq -e '
  .spec.containers[0] as $c |
  def envValue($name): ([($c.env // [])[] | select(.name == $name) | .value] | last // null);
  (([.status.conditions[]? | select(.type == "Ready") | .status] | last) == "True") and
  (envValue("TOCA_SERVICE_ROLE") == "webhook") and
  (envValue("MCP_ENABLED") == "false") and
  (envValue("META_WEBHOOK_ENABLED") == "true") and
  (envValue("META_WEBHOOK_PERSISTENCE_ENABLED") == "true") and
  ((envValue("INSTAGRAM_ENGAGEMENT_WRITES_ENABLED") // "false") == "false")
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

APP_SECRET="$(gcloud secrets versions access latest \
  --secret "$META_APP_SECRET_ID" --project "$GCP_PROJECT_ID")"
[[ -n "$APP_SECRET" ]] || {
  echo 'INSTAGRAM_WEBHOOK_INGRESS_APP_SECRET_EMPTY' >&2
  exit 1
}

WEBHOOK_URL="$WEBHOOK_URL" META_APP_SECRET_VALUE="$APP_SECRET" node --input-type=module <<'NODE'
import { createHmac, randomBytes } from 'node:crypto';

const baseUrl = process.env.WEBHOOK_URL?.trim();
const appSecret = process.env.META_APP_SECRET_VALUE?.trim();
if (!baseUrl || !appSecret) {
  console.error('INSTAGRAM_WEBHOOK_INGRESS_CHALLENGE_INPUT_MISSING');
  process.exit(1);
}

const verifyToken = createHmac('sha256', appSecret)
  .update('TOCA_META_WEBHOOK_VERIFY_TOKEN_V1', 'utf8')
  .digest('hex');
const challenge = `toca-readonly-${randomBytes(12).toString('hex')}`;
const target = new URL('/webhooks/meta', baseUrl);
target.searchParams.set('hub.mode', 'subscribe');
target.searchParams.set('hub.verify_token', verifyToken);
target.searchParams.set('hub.challenge', challenge);

let response;
try {
  response = await fetch(target, { method: 'GET', signal: AbortSignal.timeout(10_000) });
} catch {
  console.error('INSTAGRAM_WEBHOOK_INGRESS_CHALLENGE_REQUEST_FAILED');
  process.exit(1);
}
const body = await response.text();
if (!response.ok || body !== challenge) {
  console.error(`INSTAGRAM_WEBHOOK_INGRESS_CHALLENGE_FAILED:HTTP_${response.status}`);
  process.exit(1);
}

console.log('INSTAGRAM_ENGAGEMENT_WEBHOOK_INGRESS=PASS');
console.log('CALLBACK_PUBLIC_DRS_SAFE=true');
console.log('CALLBACK_CHALLENGE_PASS=true');
console.log('PROVIDER_WRITES=false');
console.log('DATABASE_MUTATIONS=false');
console.log('TRAFFIC_MUTATIONS=false');
console.log('RAW_SECRET_LOGGED=false');
NODE
unset APP_SECRET

echo "INSTAGRAM_ENGAGEMENT_WEBHOOK_REVISION=$ROUTED_REVISION"
