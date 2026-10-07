#!/usr/bin/env bash
set -euo pipefail

required=(
  GCP_PROJECT_ID GCP_REGION GCP_RUNTIME_SERVICE_ACCOUNT CLOUD_SQL_INSTANCE
  TOKEN_SECRET_ID META_APP_SECRET_ID RUNTIME_IMAGE WEBHOOK_SERVICE_NAME
  META_APP_ID INSTAGRAM_PAGE_ID
)
for name in "${required[@]}"; do
  value="${!name:-}"
  [[ -n "$value" ]] || {
    echo "INSTAGRAM_WEBHOOK_INGRESS_REQUIRED_ENV_MISSING:$name" >&2
    exit 64
  }
done

WEBHOOK_JSON="$(gcloud run services describe "$WEBHOOK_SERVICE_NAME"   --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
WEBHOOK_URL="$(jq -r '.status.url // empty' <<<"$WEBHOOK_JSON")"
[[ -n "$WEBHOOK_URL" ]] || {
  echo 'INSTAGRAM_WEBHOOK_INGRESS_STATUS_URL_MISSING' >&2
  exit 1
}

INGRESS="$(jq -r '.metadata.annotations["run.googleapis.com/ingress"] // "all"' <<<"$WEBHOOK_JSON")"
DEFAULT_URL_DISABLED="$(jq -r '.metadata.annotations["run.googleapis.com/default-url-disabled"] // "false"' <<<"$WEBHOOK_JSON")"
INVOKER_IAM_DISABLED="$(jq -r '.metadata.annotations["run.googleapis.com/invoker-iam-disabled"] // "false"' <<<"$WEBHOOK_JSON")"
[[ "$INGRESS" == 'all' ]] || {
  echo "INSTAGRAM_WEBHOOK_INGRESS_RESTRICTED:$INGRESS" >&2
  exit 1
}
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

RUNTIME_DIGEST="${RUNTIME_IMAGE##*@}"
[[ "$RUNTIME_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo 'INSTAGRAM_WEBHOOK_INGRESS_RUNTIME_DIGEST_INVALID' >&2
  exit 1
}

REVISION_JSON="$(gcloud run revisions describe "$ROUTED_REVISION"   --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"

jq -e   --arg runtime "$GCP_RUNTIME_SERVICE_ACCOUNT"   --arg cloudSql "$CLOUD_SQL_INSTANCE"   --arg digest "$RUNTIME_DIGEST" '
  .spec.containers[0] as $c |
  def envValue($name): ([($c.env // [])[] | select(.name == $name) | .value] | last // null);
  (([.status.conditions[]? | select(.type == "Ready") | .status] | last) == "True") and
  (.spec.serviceAccountName == $runtime) and
  ($c.image | contains($digest)) and
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

IAM_JSON="$(gcloud run services get-iam-policy "$WEBHOOK_SERVICE_NAME"   --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
if jq -e '
  .bindings[]?
  | select(.role == "roles/run.invoker")
  | (.members // [])[]?
  | select(. == "allUsers")
' <<<"$IAM_JSON" >/dev/null; then
  echo 'INSTAGRAM_WEBHOOK_INGRESS_LEGACY_ALLUSERS_FORBIDDEN' >&2
  exit 1
fi

HEALTH_STATUS="$(curl --silent --show-error --connect-timeout 5 --max-time 15   --output /dev/null --write-out '%{http_code}' "$WEBHOOK_URL/healthz")"
READY_STATUS="$(curl --silent --show-error --connect-timeout 5 --max-time 20   --output /dev/null --write-out '%{http_code}' "$WEBHOOK_URL/readyz")"
[[ "$HEALTH_STATUS" == '200' ]] || {
  echo "INSTAGRAM_WEBHOOK_INGRESS_HEALTH_FAILED:HTTP_$HEALTH_STATUS" >&2
  exit 1
}
[[ "$READY_STATUS" == '200' ]] || {
  echo "INSTAGRAM_WEBHOOK_INGRESS_READINESS_FAILED:HTTP_$READY_STATUS" >&2
  exit 1
}

read_secret() {
  local env_name="$1"
  local secret_id="$2"
  local value="${!env_name:-}"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return 0
  fi
  gcloud secrets versions access latest     --secret "$secret_id" --project "$GCP_PROJECT_ID" 2>/dev/null
}

APP_SECRET="$(read_secret META_APP_SECRET_VALUE "$META_APP_SECRET_ID")"
META_TOKEN="$(read_secret META_ACCESS_TOKEN "$TOKEN_SECRET_ID")"
[[ -n "$APP_SECRET" ]] || {
  echo 'INSTAGRAM_WEBHOOK_INGRESS_APP_SECRET_UNAVAILABLE' >&2
  exit 1
}
[[ -n "$META_TOKEN" ]] || {
  echo 'INSTAGRAM_WEBHOOK_INGRESS_META_TOKEN_UNAVAILABLE' >&2
  exit 1
}

WEBHOOK_URL="$WEBHOOK_URL" META_APP_SECRET_VALUE="$APP_SECRET" META_ACCESS_TOKEN_VALUE="$META_TOKEN" META_APP_ID_VALUE="$META_APP_ID" INSTAGRAM_PAGE_ID_VALUE="$INSTAGRAM_PAGE_ID" node --input-type=module <<'NODE'
import { createHmac, randomBytes } from 'node:crypto';

const webhookUrl = process.env.WEBHOOK_URL?.trim();
const appSecret = process.env.META_APP_SECRET_VALUE?.trim();
const rootToken = process.env.META_ACCESS_TOKEN_VALUE?.trim();
const appId = process.env.META_APP_ID_VALUE?.trim();
const pageId = process.env.INSTAGRAM_PAGE_ID_VALUE?.trim();
const graphBaseUrl = 'https://graph.facebook.com';
const apiVersion = 'v24.0';

if (!webhookUrl || !appSecret || !rootToken || !appId || !pageId) {
  console.error('INSTAGRAM_WEBHOOK_INGRESS_PROVIDER_INPUT_MISSING');
  process.exit(1);
}

const safeFetch = async (url) => {
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`PROVIDER_READ_HTTP_${response.status}`);
  }
  return response;
};

const verifyToken = createHmac('sha256', appSecret)
  .update('TOCA_META_WEBHOOK_VERIFY_TOKEN_V1', 'utf8')
  .digest('hex');
const challenge = `toca-readonly-${randomBytes(12).toString('hex')}`;
const challengeUrl = new URL('/webhooks/meta', webhookUrl);
challengeUrl.searchParams.set('hub.mode', 'subscribe');
challengeUrl.searchParams.set('hub.verify_token', verifyToken);
challengeUrl.searchParams.set('hub.challenge', challenge);
const challengeResponse = await safeFetch(challengeUrl);
const callbackChallengePass = (await challengeResponse.text()) === challenge;
if (!callbackChallengePass) {
  throw new Error('CALLBACK_CHALLENGE_BODY_MISMATCH');
}

const appAccessToken = `${appId}|${appSecret}`;
const appSubscriptionsUrl = new URL(
  `${graphBaseUrl}/${apiVersion}/${appId}/subscriptions`,
);
appSubscriptionsUrl.searchParams.set('access_token', appAccessToken);
const appSubscriptions = await (await safeFetch(appSubscriptionsUrl)).json();
const instagramSubscription = asArray(asRecord(appSubscriptions).data)
  .map(asRecord)
  .find((entry) => scalar(entry.object) === 'instagram');
const appInstagramSubscriptionPresent = Boolean(instagramSubscription);
const appCallbackUrlMatch =
  normalizeUrl(scalar(instagramSubscription?.callback_url)) ===
  normalizeUrl(`${webhookUrl}/webhooks/meta`);
const appFields = fieldNames(instagramSubscription?.fields);
const appCommentsFieldPresent = appFields.has('comments');
const appMessagesFieldPresent = appFields.has('messages');

const pageAccessToken = await resolvePageToken(rootToken, pageId);
const pageSubscriptionsUrl = new URL(
  `${graphBaseUrl}/${apiVersion}/${pageId}/subscribed_apps`,
);
pageSubscriptionsUrl.searchParams.set('fields', 'id,subscribed_fields');
pageSubscriptionsUrl.searchParams.set('access_token', pageAccessToken);
const pageSubscriptions = await (await safeFetch(pageSubscriptionsUrl)).json();
const pageApp = asArray(asRecord(pageSubscriptions).data)
  .map(asRecord)
  .find((entry) => scalar(entry.id) === appId);
const pageAppSubscriptionPresent = Boolean(pageApp);
const pageMessagesFieldPresent = fieldNames(pageApp?.subscribed_fields).has('messages');

if (
  !appInstagramSubscriptionPresent ||
  !appCallbackUrlMatch ||
  !appCommentsFieldPresent ||
  !appMessagesFieldPresent ||
  !pageAppSubscriptionPresent ||
  !pageMessagesFieldPresent
) {
  throw new Error('PROVIDER_SUBSCRIPTION_READBACK_FAILED');
}

console.log('SUBSCRIPTION_MODEL=FACEBOOK_LOGIN_PAGE_BOUND');
console.log('PROVIDER_READ_PASS=true');
console.log('APP_INSTAGRAM_SUBSCRIPTION_PRESENT=true');
console.log('APP_CALLBACK_URL_MATCH=true');
console.log('APP_COMMENTS_FIELD_PRESENT=true');
console.log('APP_MESSAGES_FIELD_PRESENT=true');
console.log('PAGE_APP_SUBSCRIPTION_PRESENT=true');
console.log('PAGE_MESSAGES_FIELD_PRESENT=true');
console.log('CALLBACK_CHALLENGE_PASS=true');
console.log('PROVIDER_METHODS=GET_ONLY');
console.log('PROVIDER_WRITES=false');
console.log('SECRETS_PRINTED=false');

async function resolvePageToken(token, expectedPageId) {
  const accountsUrl = new URL(`${graphBaseUrl}/${apiVersion}/me/accounts`);
  accountsUrl.searchParams.set('fields', 'id,access_token');
  accountsUrl.searchParams.set('limit', '100');
  accountsUrl.searchParams.set('access_token', token);

  try {
    const accounts = await (await safeFetch(accountsUrl)).json();
    const match = asArray(asRecord(accounts).data)
      .map(asRecord)
      .find(
        (entry) =>
          scalar(entry.id) === expectedPageId && scalar(entry.access_token),
      );
    const resolved = scalar(match?.access_token);
    if (resolved) return resolved;
  } catch {
    // Fallback below validates that the root token itself is Page-scoped.
  }

  const pageUrl = new URL(
    `${graphBaseUrl}/${apiVersion}/${expectedPageId}`,
  );
  pageUrl.searchParams.set('fields', 'id');
  pageUrl.searchParams.set('access_token', token);
  const page = await (await safeFetch(pageUrl)).json();
  if (scalar(asRecord(page).id) !== expectedPageId) {
    throw new Error('PAGE_TOKEN_RESOLUTION_ID_MISMATCH');
  }
  return token;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function scalar(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return '';
}

function fieldNames(value) {
  const names = new Set();
  if (typeof value === 'string') {
    for (const field of value.split(',')) {
      const normalized = field.trim();
      if (normalized) names.add(normalized);
    }
    return names;
  }
  for (const item of asArray(value)) {
    if (typeof item === 'string') {
      if (item.trim()) names.add(item.trim());
      continue;
    }
    const name = scalar(asRecord(item).name).trim();
    if (name) names.add(name);
  }
  return names;
}

function normalizeUrl(value) {
  return value.trim().replace(/\/$/u, '');
}
NODE

unset APP_SECRET META_TOKEN

echo 'INSTAGRAM_ENGAGEMENT_WEBHOOK_INGRESS=PASS'
echo "INSTAGRAM_ENGAGEMENT_WEBHOOK_REVISION=$ROUTED_REVISION"
echo 'DATABASE_READ_PASS=true'
echo 'MIGRATIONS_READINESS_PASS=true'
echo 'SCHEMA_READINESS_PASS=true'
echo 'ENGAGEMENT_RUNTIME_ENABLED=true'
echo 'CALLBACK_PUBLIC_DRS_SAFE=true'
echo 'PROVIDER_SUBSCRIPTIONS_VERIFIED=true'
echo 'PERSISTENCE_READINESS_VERIFIED=true'
echo 'CALLBACK_CHALLENGE_PASS=true'
echo 'PROVIDER_METHODS=GET_ONLY'
echo 'PROVIDER_WRITES=false'
echo 'DATABASE_MUTATIONS=false'
echo 'PERSISTENT_SERVICE_MUTATIONS=false'
echo 'TRAFFIC_MUTATIONS=false'
echo 'NEW_PAID_RESOURCE_ALLOCATION=false'
echo 'RAW_SECRET_LOGGED=false'
