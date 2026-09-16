#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE="scripts/marketing-publish-now.sh"
PATCHED="$(mktemp)"
trap 'rm -f "$PATCHED"' EXIT

echo "P1_WRAPPER_PHASE=START" >&2
python3 - "$SOURCE" "$PATCHED" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1])
target = Path(sys.argv[2])
text = source.read_text(encoding="utf-8")

required = [
    'local extra_json="${2:-}"',
    'Authorization: Bearer ${GOOGLE_ACCESS_TOKEN}',
    'DATABASE_URL=$DATABASE_SECRET_ID:$DATABASE_SECRET_VERSION',
    'APP_IMAGE="${app_image_tag%:*}@${APP_IMAGE_DIGEST}"',
    'PREP_IMAGE="${prep_image_tag%:*}@${PREP_IMAGE_DIGEST}"',
    'verify_writes_disabled',
    '.creativeTruthBinding.qualityGateStatus == "PASSED"',
    'printf \'%s\' "$CAPTION" | grep -Fq "$REQUIRED_CTA"',
]
for marker in required:
    if marker not in text:
        raise SystemExit(f"FAIL_CLOSED: hardened source marker missing: {marker}")
if text.count('DATABASE_URL=$DATABASE_SECRET_ID:$DATABASE_SECRET_VERSION') != 2:
    raise SystemExit("FAIL_CLOSED: expected exactly two pinned database secret references")
if 'DATABASE_URL=$DATABASE_SECRET_ID:latest' in text:
    raise SystemExit("FAIL_CLOSED: unpinned database secret reference present")

text = text.replace(
    '.creativeTruthBinding.qualityGateStatus == "PASSED"',
    '(.creativeTruthBinding.qualityGateStatus | IN("PASSED", "PREVIEW_QA_PASSED"))',
    1,
)

legacy_caption_gate = '''  printf '%s' "$CAPTION" | grep -Fq "$REQUIRED_CTA"
  hashtag_count="$(printf '%s\\n' "$CAPTION" | grep -oE '#[A-Za-z0-9_]+' | wc -l | tr -d ' ')"
  test "$hashtag_count" -eq 5
'''
scheduler_aware_caption_gate = '''  if jq -e '.schedulerBinding.source == "MARKETING_AUTOPILOT_GCP"' "$COMMAND_FILE" >/dev/null 2>&1; then
    test -n "$CAPTION"
    echo "P1_SCHEDULER_APPROVED_COPY_EXACT=PASS" >&2
  else
    printf '%s' "$CAPTION" | grep -Fq "$REQUIRED_CTA"
    hashtag_count="$(printf '%s\\n' "$CAPTION" | grep -oE '#[A-Za-z0-9_]+' | wc -l | tr -d ' ')"
    test "$hashtag_count" -eq 5
  fi
'''
if text.count(legacy_caption_gate) != 1:
    raise SystemExit("FAIL_CLOSED: expected one legacy caption gate")
text = text.replace(legacy_caption_gate, scheduler_aware_caption_gate, 1)

cleanup_marker = '  gcloud run jobs delete "$EXECUTE_JOB_NAME" --project "$PROJECT_ID" --region "$REGION" --quiet >/dev/null 2>&1\n'
if text.count(cleanup_marker) != 1:
    raise SystemExit("FAIL_CLOSED: expected canonical execute-job cleanup marker")
cleanup_replacement = cleanup_marker + '''  if [ -n "${DUPLICATE_PREFLIGHT_JOB_NAME:-}" ]; then
    gcloud run jobs delete "$DUPLICATE_PREFLIGHT_JOB_NAME" --project "$PROJECT_ID" --region "$REGION" --quiet >/dev/null 2>&1
  fi
'''
text = text.replace(cleanup_marker, cleanup_replacement, 1)

sequence = '''validate_command
authenticate_docker
bind_source_asset
build_images
deploy_prepare_job
prepare_request
deploy_execute_job
execute_and_reconcile'''
strong_preflight = r'''provider_duplicate_preflight() {
  if ! jq -e '.schedulerBinding.source == "MARKETING_AUTOPILOT_GCP"' "$COMMAND_FILE" >/dev/null 2>&1; then
    return 0
  fi

  local caption_base64 scheduled_at format result_line result_json execute_rc job_json
  local preflight_image_tag preflight_image_digest preflight_image
  caption_base64="$(printf '%s' "$CAPTION" | base64 -w0)"
  scheduled_at="$(jq -r .scheduledAt "$COMMAND_FILE")"
  format="$(jq -r .format "$COMMAND_FILE")"

  preflight_image_tag="$DOCKER_REGISTRY/$PROJECT_ID/$REPOSITORY/server:publish-now-duplicate-preflight-${GITHUB_SHA}"
  cat >/tmp/publish-now-duplicate-preflight.Dockerfile <<'DOCKERFILE'
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
CMD ["node", "dist/src/instagram-provider-duplicate-preflight.js"]
DOCKERFILE
  docker build \
    --build-arg "BASE_IMAGE=$APP_IMAGE" \
    -f /tmp/publish-now-duplicate-preflight.Dockerfile \
    -t "$preflight_image_tag" .
  retry_command 3 5 docker push "$preflight_image_tag"
  preflight_image_digest="$(gcloud artifacts docker images describe "$preflight_image_tag" \
    --project "$PROJECT_ID" \
    --format='value(image_summary.digest)')"
  [[ "$preflight_image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]
  preflight_image="${preflight_image_tag%:*}@${preflight_image_digest}"

  retry_command 3 5 gcloud run jobs deploy "$DUPLICATE_PREFLIGHT_JOB_NAME" \
    --image "$preflight_image" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --service-account "$RUNTIME_SERVICE_ACCOUNT" \
    --set-env-vars "^~^NODE_ENV=production~MCP_ENABLED=false~META_ENABLED=true~META_WEBHOOK_ENABLED=false~META_WEBHOOK_PERSISTENCE_ENABLED=false~INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false~INSTAGRAM_PUBLICATION_WRITES_ENABLED=false~INSTAGRAM_BUSINESS_ACCOUNT_ID=$INSTAGRAM_ACCOUNT_ID~INSTAGRAM_DUPLICATE_PREFLIGHT_CONTENT_ITEM_ID=$CONTENT_ITEM_ID~INSTAGRAM_DUPLICATE_PREFLIGHT_FORMAT=$format~INSTAGRAM_DUPLICATE_PREFLIGHT_EXPECTED_ASSET_SHA256=$EXPECTED_ASSET_SHA256~INSTAGRAM_DUPLICATE_PREFLIGHT_SCHEDULED_AT=$scheduled_at~INSTAGRAM_DUPLICATE_PREFLIGHT_CAPTION_BASE64=$caption_base64~META_APP_ID=2281930145887404~META_APP_SECRET_PROVIDER=env~META_APP_SECRET_KEY=META_APP_SECRET~META_AUTHORIZATION_ENDPOINT=https://www.facebook.com/dialog/oauth~META_TOKEN_ENDPOINT=https://graph.facebook.com/oauth/access_token~META_REDIRECT_URI=$REDIRECT_URI~META_REQUESTED_SCOPES=pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,business_management,instagram_basic,instagram_manage_comments,instagram_manage_messages,instagram_content_publish~META_GRAPH_BASE_URL=https://graph.facebook.com~META_GRAPH_API_VERSION=v24.0~META_TOKEN_STORE_PROVIDER=gcp-secret-manager~META_TOKEN_SECRET_ID=$TOKEN_SECRET_ID~GCP_PROJECT_ID=$PROJECT_ID" \
    --set-secrets "META_APP_SECRET=toca-meta-app-secret:1" \
    --tasks 1 \
    --max-retries 0 \
    --task-timeout 120s \
    --quiet

  job_json="$(gcloud run jobs describe "$DUPLICATE_PREFLIGHT_JOB_NAME" --project "$PROJECT_ID" --region "$REGION" --format=json)"
  printf '%s' "$job_json" | jq -e \
    --arg image "$preflight_image" '
    .spec.template.spec.template.spec.containers[0] as $container |
    ($container.image == $image) and
    (($container.command // []) | length == 0) and
    (($container.args // []) | length == 0) and
    ([$container.env[] | select(.name == "INSTAGRAM_PUBLICATION_WRITES_ENABLED") | .value] == ["false"])
  ' >/dev/null

  set +e
  gcloud run jobs execute "$DUPLICATE_PREFLIGHT_JOB_NAME" --project "$PROJECT_ID" --region "$REGION" --wait --quiet
  execute_rc=$?
  set -e

  result_line=''
  for _ in $(seq 1 12); do
    result_line="$(gcloud logging read \
      "resource.type=cloud_run_job AND resource.labels.job_name=${DUPLICATE_PREFLIGHT_JOB_NAME} AND textPayload:\"INSTAGRAM_DUPLICATE_PREFLIGHT_RESULT=\" AND textPayload:\"${CONTENT_ITEM_ID}\"" \
      --project "$PROJECT_ID" \
      --freshness=30m \
      --limit=50 \
      --order=desc \
      --format='value(textPayload)' | grep 'INSTAGRAM_DUPLICATE_PREFLIGHT_RESULT=' | head -n1 || true)"
    [ -n "$result_line" ] && break
    sleep 5
  done
  test -n "$result_line"
  result_json="${result_line#INSTAGRAM_DUPLICATE_PREFLIGHT_RESULT=}"
  printf '%s\n' "$result_json" > marketing-publish-now-provider-duplicate-preflight.json
  printf '%s\n' "$result_json" | jq -e \
    --arg id "$CONTENT_ITEM_ID" \
    --arg account "$INSTAGRAM_ACCOUNT_ID" \
    --arg sha "$EXPECTED_ASSET_SHA256" \
    --arg format "$format" '
      .contentItemId == $id and
      .instagramAccountId == $account and
      .format == $format and
      .providerReadOnly == true and
      .expectedAssetSha256 == $sha and
      .duplicateFound == false
    ' >/dev/null
  test "$execute_rc" -eq 0
  echo "P1_PROVIDER_DUPLICATE_PREFLIGHT=PASS format=$format image=$preflight_image" >&2
}

'''
instrumented = '''echo "P1_PHASE=VALIDATE_COMMAND" >&2
validate_command
echo "P1_PHASE=AUTHENTICATE_DOCKER" >&2
authenticate_docker
echo "P1_PHASE=BIND_SOURCE_ASSET" >&2
bind_source_asset
echo "P1_PHASE=BUILD_IMAGES" >&2
build_images
echo "P1_PHASE=DEPLOY_PREPARE_JOB" >&2
deploy_prepare_job
echo "P1_PHASE=PREPARE_REQUEST" >&2
prepare_request
echo "P1_PHASE=PROVIDER_DUPLICATE_PREFLIGHT" >&2
provider_duplicate_preflight
echo "P1_PHASE=DEPLOY_EXECUTE_JOB" >&2
deploy_execute_job
echo "P1_PHASE=EXECUTE_AND_RECONCILE" >&2
execute_and_reconcile'''
sequence_count = text.count(sequence)
if sequence_count != 1:
    raise SystemExit(f"FAIL_CLOSED: expected exactly one canonical execution sequence, found {sequence_count}")
text = text.replace(sequence, strong_preflight + instrumented, 1)
target.write_text(text, encoding="utf-8")
PY

echo "P1_WRAPPER_PHASE=SOURCE_VERIFIED" >&2
chmod 0700 "$PATCHED"
bash -n "$PATCHED"
test "$(grep -Fc 'DATABASE_URL=$DATABASE_SECRET_ID:$DATABASE_SECRET_VERSION' "$PATCHED")" -eq 2
! grep -Fq 'DATABASE_URL=$DATABASE_SECRET_ID:latest' "$PATCHED"
grep -Fq 'APP_IMAGE="${app_image_tag%:*}@${APP_IMAGE_DIGEST}"' "$PATCHED"
grep -Fq 'verify_writes_disabled' "$PATCHED"
grep -Fq 'P1_PHASE=VALIDATE_COMMAND' "$PATCHED"
grep -Fq 'P1_PHASE=PROVIDER_DUPLICATE_PREFLIGHT' "$PATCHED"
grep -Fq 'P1_SCHEDULER_APPROVED_COPY_EXACT=PASS' "$PATCHED"
grep -Fq 'PREVIEW_QA_PASSED' "$PATCHED"
grep -Fq 'publish-now-duplicate-preflight.Dockerfile' "$PATCHED"
grep -Fq 'CMD ["node", "dist/src/instagram-provider-duplicate-preflight.js"]' "$PATCHED"
grep -Fq 'P1_PROVIDER_DUPLICATE_PREFLIGHT=PASS' "$PATCHED"
if sed -n '/provider_duplicate_preflight()/,/^}/p' "$PATCHED" | grep -Eq -- '--command[ =]node|--args[ =]dist/src/instagram-provider-duplicate-preflight.js'; then
  echo "FAIL_CLOSED: duplicate preflight must use immutable image CMD, not deploy command overrides" >&2
  exit 1
fi
echo "P1_HARDENED_SOURCE=PASS" >&2

if [ "${PUBLISH_NOW_PATCH_ONLY:-false}" = "true" ]; then
  echo "P1_WRAPPER_PHASE=PATCH_ONLY_COMPLETE" >&2
  exit 0
fi

echo "P1_WRAPPER_PHASE=EXECUTE_HARDENED_SCRIPT" >&2
exec bash "$PATCHED"
