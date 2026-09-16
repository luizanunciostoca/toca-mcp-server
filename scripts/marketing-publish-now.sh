#!/usr/bin/env bash
set -Eeuo pipefail

COMMAND_FILE="${COMMAND_FILE:-control/marketing-publish-now-command.json}"
PUBLICATION_POLICY_MODE="${PUBLICATION_POLICY_MODE:-FAST_PATH}"
case "$PUBLICATION_POLICY_MODE" in
  FAST_PATH|SCHEDULED) ;;
  *) echo "PUBLICATION_POLICY_MODE_INVALID:$PUBLICATION_POLICY_MODE" >&2; exit 1 ;;
esac
RUN_EVIDENCE="marketing-publish-now-run.json"
PREPARATION_EVIDENCE="marketing-publish-now-preparation.json"
PUBLICATION_EVIDENCE="marketing-publish-now-publication.json"
RECONCILIATION_EVIDENCE="marketing-publish-now-reconciliation.json"
DOCKER_REGISTRY="${REGION}-docker.pkg.dev"

: "${DATABASE_SECRET_VERSION:?DATABASE_SECRET_VERSION_REQUIRED}"
printf '%s' "$DATABASE_SECRET_VERSION" | grep -Eq '^[1-9][0-9]*$'

cleanup() {
  local rc=$?
  trap - EXIT
  set +e
  gcloud run jobs delete "$PREPARE_JOB_NAME" --project "$PROJECT_ID" --region "$REGION" --quiet >/dev/null 2>&1
  gcloud run jobs delete "$EXECUTE_JOB_NAME" --project "$PROJECT_ID" --region "$REGION" --quiet >/dev/null 2>&1
  docker logout "$DOCKER_REGISTRY" >/dev/null 2>&1
  exit "$rc"
}
trap cleanup EXIT

retry_command() {
  local attempts="$1"
  local delay_seconds="$2"
  shift 2
  local attempt=1
  until "$@"; do
    if [ "$attempt" -ge "$attempts" ]; then
      return 1
    fi
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done
}

write_run_evidence() {
  local state="$1"
  local extra_json="${2:-}"
  [ -n "$extra_json" ] || extra_json='{}'
  jq -n \
    --arg commandId "$COMMAND_ID" \
    --arg contentItemId "$CONTENT_ITEM_ID" \
    --arg correlationId "$CORRELATION_ID" \
    --arg idempotencyKey "$IDEMPOTENCY_KEY" \
    --arg expectedAssetSha256 "$EXPECTED_ASSET_SHA256" \
    --arg state "$state" \
    --argjson extra "$extra_json" \
    '{commandId:$commandId,contentItemId:$contentItemId,correlationId:$correlationId,idempotencyKey:$idempotencyKey,expectedAssetSha256:$expectedAssetSha256,state:$state} + $extra' \
    > "$RUN_EVIDENCE"
}

validate_command() {
  jq -e '
    .schemaVersion == 1 and
    (.commandId | type == "string") and
    .action == "PUBLISH_NOW" and
    (.issuedAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}-03:00$")) and
    .timezone == "America/Bahia" and
    (.operation | IN("SUNSET", "THE_PARTY")) and
    .channel == "INSTAGRAM" and
    (.format | IN("FEED_IMAGE", "STORY_IMAGE")) and
    .contentType == "image/jpeg" and
    .instagramAccountId == "17841402033495654" and
    .approvalMode == "EXPLICIT_APPROVAL" and
    .approvalStatus == "APPROVED" and
    .publicationIntent == "SHARE_NOW" and
    (.contentItemId | length > 0) and
    (.assetId | length > 0) and
    (.driveFileId | length > 0) and
    (.expectedAssetSha256 | test("^[a-f0-9]{64}$")) and
    (.caption | length > 0) and
    (.correlationId | length > 0) and
    (.idempotencyKey | length > 0) and
    .creativeTruthBinding.policyId == "TOCA_CREATIVE_TRUTH_POLICY_V1" and
    (.creativeTruthBinding.standardId | length > 0) and
    (.creativeTruthBinding.creativeId | length > 0) and
    .creativeTruthBinding.outputSha256 == .expectedAssetSha256 and
    .creativeTruthBinding.brandIntegrityStatus == "PASSED" and
    .creativeTruthBinding.venueFidelityStatus == "PASSED" and
    .creativeTruthBinding.qualityGateStatus == "PASSED" and
    .creativeTruthBinding.exactAssetBinding == true
  ' "$COMMAND_FILE" >/dev/null

  COMMAND_ID="$(jq -r .commandId "$COMMAND_FILE")"
  CONTENT_ITEM_ID="$(jq -r .contentItemId "$COMMAND_FILE")"
  ASSET_ID="$(jq -r .assetId "$COMMAND_FILE")"
  DRIVE_FILE_ID="$(jq -r .driveFileId "$COMMAND_FILE")"
  CONTENT_TYPE="$(jq -r .contentType "$COMMAND_FILE")"
  EXPECTED_ASSET_SHA256="$(jq -r .expectedAssetSha256 "$COMMAND_FILE")"
  CORRELATION_ID="$(jq -r .correlationId "$COMMAND_FILE")"
  IDEMPOTENCY_KEY="$(jq -r .idempotencyKey "$COMMAND_FILE")"
  FORMAT="$(jq -r .format "$COMMAND_FILE")"
  CAPTION="$(jq -r .caption "$COMMAND_FILE")"
  ISSUED_AT="$(jq -r .issuedAt "$COMMAND_FILE")"

  for value in "$COMMAND_ID" "$CONTENT_ITEM_ID" "$ASSET_ID" "$CORRELATION_ID" "$IDEMPOTENCY_KEY"; do
    printf '%s' "$value" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
  done
  printf '%s' "$DRIVE_FILE_ID" | grep -Eq '^[A-Za-z0-9_-]{10,128}$'

  local now_epoch issued_epoch age_seconds hashtag_count scheduled_epoch scheduled_delta scheduled_max_delay_seconds
  SCHEDULED_AT=""
  now_epoch="$(date +%s)"
  issued_epoch="$(date -d "$ISSUED_AT" +%s)"
  age_seconds=$((now_epoch - issued_epoch))
  test "$age_seconds" -ge -120
  test "$age_seconds" -le 1800

  if [ "$PUBLICATION_POLICY_MODE" = "FAST_PATH" ]; then
    printf '%s' "$CAPTION" | grep -Fq "$REQUIRED_CTA"
    hashtag_count="$(printf '%s\n' "$CAPTION" | grep -oE '#[A-Za-z0-9_]+' | wc -l | tr -d ' ')"
    test "$hashtag_count" -eq 5
  else
    jq -e '
      .schedulingPolicy == "SCHEDULED_GCP" and
      (.scheduledAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}-03:00$"))
    ' "$COMMAND_FILE" >/dev/null
    SCHEDULED_AT="$(jq -r .scheduledAt "$COMMAND_FILE")"
    scheduled_epoch="$(date -d "$SCHEDULED_AT" +%s)"
    scheduled_delta=$((now_epoch - scheduled_epoch))
    scheduled_max_delay_seconds="${SCHEDULED_MAX_DELAY_SECONDS:-1800}"
    printf '%s' "$scheduled_max_delay_seconds" | grep -Eq '^[0-9]+$'
    test "$scheduled_max_delay_seconds" -ge 300
    test "$scheduled_max_delay_seconds" -le 1800
    test "$scheduled_delta" -ge 0
    test "$scheduled_delta" -le "$scheduled_max_delay_seconds"
  fi

  if [ "$FORMAT" = "FEED_IMAGE" ]; then
    MEDIA_TYPE=IMAGE
  else
    MEDIA_TYPE=STORY
  fi

  write_run_evidence "COMMAND_VALIDATED" "$(jq -n \
    --arg issuedAt "$ISSUED_AT" \
    --arg policyMode "$PUBLICATION_POLICY_MODE" \
    --arg scheduledAt "$SCHEDULED_AT" \
    '{issuedAt:$issuedAt,policyMode:$policyMode} + (if $scheduledAt == "" then {} else {scheduledAt:$scheduledAt} end)')"
}

authenticate_docker() {
  test -n "${GOOGLE_ACCESS_TOKEN:-}"
  printf '%s' "$GOOGLE_ACCESS_TOKEN" | \
    docker login -u oauth2accesstoken --password-stdin "https://${DOCKER_REGISTRY}" >/dev/null
}

bind_source_asset() {
  mkdir -p .publish-now
  curl --fail --silent --show-error --location \
    --header "Authorization: Bearer ${GOOGLE_ACCESS_TOKEN}" \
    "https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media" \
    --output .publish-now/asset.jpg
  test -s .publish-now/asset.jpg
  local file_type
  file_type="$(file --brief --mime-type .publish-now/asset.jpg)"
  test "$file_type" = "$CONTENT_TYPE"
  SOURCE_ASSET_SHA256="$(sha256sum .publish-now/asset.jpg | awk '{print $1}')"
  test "$SOURCE_ASSET_SHA256" = "$EXPECTED_ASSET_SHA256"
  write_run_evidence "ASSET_BOUND" "$(jq -n --arg actualAssetSha256 "$SOURCE_ASSET_SHA256" '{actualAssetSha256:$actualAssetSha256}')"
}

build_images() {
  local app_image_tag prep_image_tag
  app_image_tag="$DOCKER_REGISTRY/$PROJECT_ID/$REPOSITORY/server:publish-now-app-${GITHUB_SHA}"
  prep_image_tag="$DOCKER_REGISTRY/$PROJECT_ID/$REPOSITORY/server:publish-now-prepare-${GITHUB_SHA}"

  docker build -t "$app_image_tag" .
  retry_command 3 5 docker push "$app_image_tag"
  APP_IMAGE_DIGEST="$(gcloud artifacts docker images describe "$app_image_tag" \
    --project "$PROJECT_ID" \
    --format='value(image_summary.digest)')"
  [[ "$APP_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]
  APP_IMAGE="${app_image_tag%:*}@${APP_IMAGE_DIGEST}"

  cat >/tmp/publish-now-prepare.Dockerfile <<'DOCKERFILE'
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
COPY .publish-now/asset.jpg /app/publish-now-asset.jpg
RUN chown node:node /app/publish-now-asset.jpg && chmod 0444 /app/publish-now-asset.jpg
USER node
DOCKERFILE

  docker build \
    --build-arg "BASE_IMAGE=$APP_IMAGE" \
    -f /tmp/publish-now-prepare.Dockerfile \
    -t "$prep_image_tag" .
  retry_command 3 5 docker push "$prep_image_tag"
  PREP_IMAGE_DIGEST="$(gcloud artifacts docker images describe "$prep_image_tag" \
    --project "$PROJECT_ID" \
    --format='value(image_summary.digest)')"
  [[ "$PREP_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]
  PREP_IMAGE="${prep_image_tag%:*}@${PREP_IMAGE_DIGEST}"

  write_run_evidence "IMAGES_BOUND" "$(jq -n \
    --arg appImage "$APP_IMAGE" \
    --arg prepareImage "$PREP_IMAGE" \
    '{appImage:$appImage,prepareImage:$prepareImage}')"
}

deploy_prepare_job() {
  local caption_base64
  caption_base64="$(printf '%s' "$CAPTION" | base64 -w0)"
  gcloud run jobs deploy "$PREPARE_JOB_NAME" \
    --image "$PREP_IMAGE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --service-account "$RUNTIME_SERVICE_ACCOUNT" \
    --command node \
    --args dist/src/instagram-first-publication-prepare.js \
    --set-env-vars "^@^NODE_ENV=production@MCP_ENABLED=false@META_ENABLED=true@META_WEBHOOK_ENABLED=false@META_WEBHOOK_PERSISTENCE_ENABLED=false@INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false@INSTAGRAM_PUBLICATION_WRITES_ENABLED=false@INSTAGRAM_BUSINESS_ACCOUNT_ID=$INSTAGRAM_ACCOUNT_ID@META_APP_ID=2281930145887404@META_APP_SECRET_PROVIDER=env@META_APP_SECRET_KEY=META_APP_SECRET@META_AUTHORIZATION_ENDPOINT=https://www.facebook.com/dialog/oauth@META_TOKEN_ENDPOINT=https://graph.facebook.com/oauth/access_token@META_REDIRECT_URI=$REDIRECT_URI@META_REQUESTED_SCOPES=pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,business_management,instagram_basic,instagram_manage_comments,instagram_manage_messages,instagram_content_publish@META_GRAPH_BASE_URL=https://graph.facebook.com@META_GRAPH_API_VERSION=v24.0@META_TOKEN_STORE_PROVIDER=gcp-secret-manager@META_TOKEN_SECRET_ID=$TOKEN_SECRET_ID@GCP_PROJECT_ID=$PROJECT_ID@INSTAGRAM_PUBLICATION_ASSET_BUCKET=$PUBLICATION_ASSET_BUCKET@INSTAGRAM_PUBLICATION_ASSET_ID=$ASSET_ID@INSTAGRAM_PUBLICATION_CORRELATION_ID=$CORRELATION_ID@INSTAGRAM_PUBLICATION_ASSET_SOURCE_PATH=/app/publish-now-asset.jpg@INSTAGRAM_PUBLICATION_ASSET_CONTENT_TYPE=$CONTENT_TYPE@INSTAGRAM_PUBLICATION_MEDIA_TYPE=$MEDIA_TYPE@INSTAGRAM_FIRST_PUBLICATION_CAPTION_BASE64=$caption_base64@INSTAGRAM_FIRST_PUBLICATION_IDEMPOTENCY_KEY=$IDEMPOTENCY_KEY" \
    --set-secrets "META_APP_SECRET=toca-meta-app-secret:1" \
    --tasks 1 \
    --max-retries 0 \
    --task-timeout 120s \
    --quiet

  local job_json
  job_json="$(gcloud run jobs describe "$PREPARE_JOB_NAME" --project "$PROJECT_ID" --region "$REGION" --format=json)"
  printf '%s' "$job_json" | jq -e '
    .spec.template.spec.template.spec.containers[0] as $container |
    ($container.command == ["node"]) and
    ($container.args == ["dist/src/instagram-first-publication-prepare.js"]) and
    ([$container.env[] | select(.name == "INSTAGRAM_PUBLICATION_WRITES_ENABLED") | .value] == ["false"])
  ' >/dev/null
}

prepare_request() {
  gcloud run jobs execute "$PREPARE_JOB_NAME" --project "$PROJECT_ID" --region "$REGION" --wait --quiet

  local result_line=""
  local attempt
  for attempt in $(seq 1 12); do
    result_line="$(gcloud logging read \
      "resource.type=cloud_run_job AND resource.labels.job_name=${PREPARE_JOB_NAME} AND textPayload:\"INSTAGRAM_FIRST_PUBLICATION_PREPARE_RESULT=\" AND textPayload:\"${CORRELATION_ID}\"" \
      --project "$PROJECT_ID" \
      --freshness=30m \
      --limit=50 \
      --order=desc \
      --format='value(textPayload)' | grep 'INSTAGRAM_FIRST_PUBLICATION_PREPARE_RESULT=' | head -n1 || true)"
    [ -n "$result_line" ] && break
    sleep 5
  done
  test -n "$result_line" || return 1

  local result_json
  result_json="${result_line#INSTAGRAM_FIRST_PUBLICATION_PREPARE_RESULT=}"
  printf '%s\n' "$result_json" | jq -e \
    --arg ig "$INSTAGRAM_ACCOUNT_ID" \
    --arg media "$MEDIA_TYPE" \
    --arg correlation "$CORRELATION_ID" \
    --arg idempotency "$IDEMPOTENCY_KEY" \
    --arg caption "$CAPTION" \
    --arg sourceSha "$SOURCE_ASSET_SHA256" '
      .asset.sha256 == $sourceSha and
      (.asset.publicUrl | startswith("https://storage.googleapis.com/")) and
      (.manifest.requestSha256 | test("^[a-f0-9]{64}$")) and
      .manifest.request.account.instagramAccountId == $ig and
      .manifest.request.mediaType == $media and
      .manifest.request.correlationId == $correlation and
      .manifest.request.idempotencyKey == $idempotency and
      .manifest.request.caption == $caption and
      .manifest.request.publicationAssetSha256 == $sourceSha and
      .manifest.request.creativeTruthBinding.outputSha256 == $sourceSha and
      (.manifest.request.mediaUrls | length == 1)
    ' >/dev/null

  printf '%s\n' "$result_json" | jq \
    --arg commandId "$COMMAND_ID" \
    --arg contentItemId "$CONTENT_ITEM_ID" \
    --arg sourceAssetSha256 "$SOURCE_ASSET_SHA256" \
    '. + {commandId:$commandId, contentItemId:$contentItemId, sourceAssetSha256:$sourceAssetSha256}' \
    > "$PREPARATION_EVIDENCE"

  APPROVED_REQUEST_SHA256="$(jq -r .manifest.requestSha256 "$PREPARATION_EVIDENCE")"
  REQUEST_BASE64="$(jq -c .manifest.request "$PREPARATION_EVIDENCE" | base64 -w0)"
}

deploy_execute_job() {
  gcloud run jobs deploy "$EXECUTE_JOB_NAME" \
    --image "$APP_IMAGE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --service-account "$RUNTIME_SERVICE_ACCOUNT" \
    --set-cloudsql-instances "$CLOUD_SQL_INSTANCE" \
    --command node \
    --args dist/src/instagram-controlled-publication.js \
    --set-env-vars "^~^NODE_ENV=production~MCP_ENABLED=false~META_ENABLED=true~META_WEBHOOK_ENABLED=false~META_WEBHOOK_PERSISTENCE_ENABLED=false~INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false~INSTAGRAM_PUBLICATION_WRITES_ENABLED=true~INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256=$APPROVED_REQUEST_SHA256~INSTAGRAM_BUSINESS_ACCOUNT_ID=$INSTAGRAM_ACCOUNT_ID~INSTAGRAM_PUBLICATION_REQUEST_BASE64=$REQUEST_BASE64~META_APP_ID=2281930145887404~META_APP_SECRET_PROVIDER=env~META_APP_SECRET_KEY=META_APP_SECRET~META_AUTHORIZATION_ENDPOINT=https://www.facebook.com/dialog/oauth~META_TOKEN_ENDPOINT=https://graph.facebook.com/oauth/access_token~META_REDIRECT_URI=$REDIRECT_URI~META_REQUESTED_SCOPES=pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,business_management,instagram_basic,instagram_manage_comments,instagram_manage_messages,instagram_content_publish~META_GRAPH_BASE_URL=https://graph.facebook.com~META_GRAPH_API_VERSION=v24.0~META_TOKEN_STORE_PROVIDER=gcp-secret-manager~META_TOKEN_SECRET_ID=$TOKEN_SECRET_ID~GCP_PROJECT_ID=$PROJECT_ID" \
    --set-secrets "META_APP_SECRET=toca-meta-app-secret:1,DATABASE_URL=$DATABASE_SECRET_ID:$DATABASE_SECRET_VERSION" \
    --tasks 1 \
    --max-retries 0 \
    --task-timeout 180s \
    --quiet

  local job_json
  job_json="$(gcloud run jobs describe "$EXECUTE_JOB_NAME" --project "$PROJECT_ID" --region "$REGION" --format=json)"
  printf '%s' "$job_json" | jq -e --arg sha "$APPROVED_REQUEST_SHA256" '
    .spec.template.spec.template.spec.containers[0] as $container |
    ($container.command == ["node"]) and
    ($container.args == ["dist/src/instagram-controlled-publication.js"]) and
    ([$container.env[] | select(.name == "INSTAGRAM_PUBLICATION_WRITES_ENABLED") | .value] == ["true"]) and
    ([$container.env[] | select(.name == "INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256") | .value] == [$sha]) and
    ([$container.env[] | select(.name == "INSTAGRAM_PUBLICATION_REQUEST_BASE64") | .value] | length == 1)
  ' >/dev/null
}

verify_writes_disabled() {
  local job_json
  job_json="$(gcloud run jobs describe "$EXECUTE_JOB_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format=json)"
  printf '%s' "$job_json" | jq -e '
    .spec.template.spec.template.spec.containers[0] as $container |
    ([$container.env[] | select(.name == "INSTAGRAM_PUBLICATION_WRITES_ENABLED") | .value] == ["false"])
  ' >/dev/null
}

disable_writes() {
  gcloud run jobs update "$EXECUTE_JOB_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --update-env-vars INSTAGRAM_PUBLICATION_WRITES_ENABLED=false \
    --quiet
  verify_writes_disabled
}

run_provider_readback() {
  retry_command 3 5 gcloud run jobs deploy "$EXECUTE_JOB_NAME" \
    --image "$APP_IMAGE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --service-account "$RUNTIME_SERVICE_ACCOUNT" \
    --set-cloudsql-instances "$CLOUD_SQL_INSTANCE" \
    --command node \
    --args dist/src/instagram-first-publication-verify.js \
    --set-env-vars "^~^NODE_ENV=production~MCP_ENABLED=false~META_ENABLED=true~META_WEBHOOK_ENABLED=false~META_WEBHOOK_PERSISTENCE_ENABLED=false~INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false~INSTAGRAM_PUBLICATION_WRITES_ENABLED=false~INSTAGRAM_BUSINESS_ACCOUNT_ID=$INSTAGRAM_ACCOUNT_ID~INSTAGRAM_FIRST_PUBLICATION_APPROVED_REQUEST_SHA256=$APPROVED_REQUEST_SHA256~INSTAGRAM_FIRST_PUBLICATION_CORRELATION_ID=$CORRELATION_ID~INSTAGRAM_FIRST_PUBLICATION_IDEMPOTENCY_KEY=$IDEMPOTENCY_KEY~META_APP_ID=2281930145887404~META_APP_SECRET_PROVIDER=env~META_APP_SECRET_KEY=META_APP_SECRET~META_AUTHORIZATION_ENDPOINT=https://www.facebook.com/dialog/oauth~META_TOKEN_ENDPOINT=https://graph.facebook.com/oauth/access_token~META_REDIRECT_URI=$REDIRECT_URI~META_REQUESTED_SCOPES=pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,business_management,instagram_basic,instagram_manage_comments,instagram_manage_messages,instagram_content_publish~META_GRAPH_BASE_URL=https://graph.facebook.com~META_GRAPH_API_VERSION=v24.0~META_TOKEN_STORE_PROVIDER=gcp-secret-manager~META_TOKEN_SECRET_ID=$TOKEN_SECRET_ID~GCP_PROJECT_ID=$PROJECT_ID" \
    --set-secrets "META_APP_SECRET=toca-meta-app-secret:1,DATABASE_URL=$DATABASE_SECRET_ID:$DATABASE_SECRET_VERSION" \
    --tasks 1 \
    --max-retries 0 \
    --task-timeout 120s \
    --quiet || return $?

  retry_command 3 5 gcloud run jobs execute "$EXECUTE_JOB_NAME" --project "$PROJECT_ID" --region "$REGION" --wait --quiet || return $?

  local result_line=""
  local attempt
  for attempt in $(seq 1 12); do
    result_line="$(gcloud logging read \
      "resource.type=cloud_run_job AND resource.labels.job_name=${EXECUTE_JOB_NAME} AND textPayload:\"INSTAGRAM_FIRST_PUBLICATION_VERIFY_RESULT=\" AND textPayload:\"${CORRELATION_ID}\"" \
      --project "$PROJECT_ID" \
      --freshness=30m \
      --limit=50 \
      --order=desc \
      --format='value(textPayload)' | grep 'INSTAGRAM_FIRST_PUBLICATION_VERIFY_RESULT=' | head -n1 || true)"
    [ -n "$result_line" ] && break
    sleep 5
  done
  test -n "$result_line" || return 1

  local result_json
  result_json="${result_line#INSTAGRAM_FIRST_PUBLICATION_VERIFY_RESULT=}"
  printf '%s\n' "$result_json" | jq -e \
    --arg sha "$APPROVED_REQUEST_SHA256" \
    --arg correlation "$CORRELATION_ID" '
      .requestSha256 == $sha and
      .status == "PUBLISHED" and
      (.publicationId | length > 0) and
      .correlationId == $correlation
    ' >/dev/null || return $?

  printf '%s\n' "$result_json" | jq \
    --arg commandId "$COMMAND_ID" \
    --arg contentItemId "$CONTENT_ITEM_ID" \
    '. + {commandId:$commandId, contentItemId:$contentItemId}' \
    > "$PUBLICATION_EVIDENCE"
}

execute_and_reconcile() {
  local execute_rc=0
  local disable_rc=0
  local readback_rc=0
  local final_disable_rc=0
  EXECUTE_ATTEMPTED=1

  set +e
  gcloud run jobs execute "$EXECUTE_JOB_NAME" --project "$PROJECT_ID" --region "$REGION" --wait --quiet
  execute_rc=$?
  set -e

  set +e
  disable_writes
  disable_rc=$?
  set -e

  set +e
  run_provider_readback
  readback_rc=$?
  verify_writes_disabled
  final_disable_rc=$?
  set -e

  local outcome
  if [ "$disable_rc" -eq 0 ] && [ "$readback_rc" -eq 0 ] && [ "$final_disable_rc" -eq 0 ]; then
    if [ "$execute_rc" -eq 0 ]; then
      outcome="PUBLISHED_VERIFIED"
    else
      outcome="PUBLISHED_VERIFIED_AFTER_EXECUTE_ERROR"
    fi
  else
    outcome="RECONCILIATION_REQUIRED"
  fi

  jq -n \
    --arg commandId "$COMMAND_ID" \
    --arg contentItemId "$CONTENT_ITEM_ID" \
    --arg correlationId "$CORRELATION_ID" \
    --arg idempotencyKey "$IDEMPOTENCY_KEY" \
    --arg approvedRequestSha256 "$APPROVED_REQUEST_SHA256" \
    --arg appImage "$APP_IMAGE" \
    --arg prepareImage "$PREP_IMAGE" \
    --arg outcome "$outcome" \
    --argjson executeExitCode "$execute_rc" \
    --argjson disableExitCode "$disable_rc" \
    --argjson readbackExitCode "$readback_rc" \
    --argjson finalDisableVerificationExitCode "$final_disable_rc" \
    --argjson writeCapabilityDisabledAfterAttempt "$([ "$disable_rc" -eq 0 ] && printf true || printf false)" \
    --argjson finalWriteCapabilityDisabled "$([ "$final_disable_rc" -eq 0 ] && printf true || printf false)" \
    '{commandId:$commandId,contentItemId:$contentItemId,correlationId:$correlationId,idempotencyKey:$idempotencyKey,approvedRequestSha256:$approvedRequestSha256,appImage:$appImage,prepareImage:$prepareImage,sideEffectAttempted:true,writeCapabilityDisabledAfterAttempt:$writeCapabilityDisabledAfterAttempt,finalWriteCapabilityDisabled:$finalWriteCapabilityDisabled,providerReadbackAttempted:true,executeExitCode:$executeExitCode,disableExitCode:$disableExitCode,readbackExitCode:$readbackExitCode,finalDisableVerificationExitCode:$finalDisableVerificationExitCode,outcome:$outcome}' \
    > "$RECONCILIATION_EVIDENCE"

  if [ "$disable_rc" -ne 0 ] || [ "$readback_rc" -ne 0 ] || [ "$final_disable_rc" -ne 0 ]; then
    write_run_evidence "RECONCILIATION_REQUIRED" "$(jq -n \
      --arg approvedRequestSha256 "$APPROVED_REQUEST_SHA256" \
      --arg appImage "$APP_IMAGE" \
      --arg prepareImage "$PREP_IMAGE" \
      '{approvedRequestSha256:$approvedRequestSha256,appImage:$appImage,prepareImage:$prepareImage}')"
    return 1
  fi

  write_run_evidence "PUBLISHED_VERIFIED" "$(jq -n \
    --arg approvedRequestSha256 "$APPROVED_REQUEST_SHA256" \
    --arg appImage "$APP_IMAGE" \
    --arg prepareImage "$PREP_IMAGE" \
    '{approvedRequestSha256:$approvedRequestSha256,appImage:$appImage,prepareImage:$prepareImage}')"
  return 0
}

validate_command
authenticate_docker
bind_source_asset
build_images
deploy_prepare_job
prepare_request
deploy_execute_job
execute_and_reconcile
