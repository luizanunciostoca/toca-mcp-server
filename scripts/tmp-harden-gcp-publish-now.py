from pathlib import Path
import re

source_path = Path('scripts/marketing-publish-now.sh')
wrapper_path = Path('scripts/marketing-publish-now-fixed.sh')
source = source_path.read_text(encoding='utf-8')

legacy_extra = '  local extra_json="${2:-{}}"'
fixed_extra = '  local extra_json="${2:-}"\n  [ -n "$extra_json" ] || extra_json=\'{}\''
if source.count(legacy_extra) != 1:
    raise SystemExit(f'expected one legacy extra_json expansion, found {source.count(legacy_extra)}')
source = source.replace(legacy_extra, fixed_extra, 1)

legacy_db = 'DATABASE_URL=$DATABASE_SECRET_ID:latest'
pinned_db = 'DATABASE_URL=$DATABASE_SECRET_ID:$DATABASE_SECRET_VERSION'
if source.count(legacy_db) != 2:
    raise SystemExit(f'expected two unpinned database secret mounts, found {source.count(legacy_db)}')
source = source.replace(legacy_db, pinned_db)
if legacy_db in source or source.count(pinned_db) != 2:
    raise SystemExit('database secret pinning invariant failed')

registry_anchor = 'DOCKER_REGISTRY="${REGION}-docker.pkg.dev"\n'
if source.count(registry_anchor) != 1:
    raise SystemExit('docker registry anchor mismatch')
source = source.replace(
    registry_anchor,
    registry_anchor
    + '\n: "${DATABASE_SECRET_VERSION:?DATABASE_SECRET_VERSION_REQUIRED}"\n'
    + "printf '%s' \"$DATABASE_SECRET_VERSION\" | grep -Eq '^[1-9][0-9]*$'\n",
    1,
)

if '--header "Authorization: Bearer ${GOOGLE_ACCESS_TOKEN}"' not in source:
    raise SystemExit('Drive OAuth bearer binding missing')

new_build = r'''build_images() {
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
}'''
source, count = re.subn(
    r'build_images\(\) \{\n.*?\n\}\n\ndeploy_prepare_job\(\) \{',
    new_build + '\n\ndeploy_prepare_job() {',
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f'build_images replacement count={count}')

new_disable = r'''verify_writes_disabled() {
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
}'''
source, count = re.subn(
    r'disable_writes\(\) \{\n.*?\n\}\n\nrun_provider_readback\(\) \{',
    new_disable + '\n\nrun_provider_readback() {',
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f'disable_writes replacement count={count}')

new_execute = r'''execute_and_reconcile() {
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
}'''
source, count = re.subn(
    r'execute_and_reconcile\(\) \{\n.*?\n\}\n\nvalidate_command',
    new_execute + '\n\nvalidate_command',
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f'execute_and_reconcile replacement count={count}')

for required in [
    'Authorization: Bearer ${GOOGLE_ACCESS_TOKEN}',
    'APP_IMAGE="${app_image_tag%:*}@${APP_IMAGE_DIGEST}"',
    'PREP_IMAGE="${prep_image_tag%:*}@${PREP_IMAGE_DIGEST}"',
    'verify_writes_disabled',
    'writeCapabilityDisabledAfterAttempt:$writeCapabilityDisabledAfterAttempt',
    'finalWriteCapabilityDisabled:$finalWriteCapabilityDisabled',
]:
    if required not in source:
        raise SystemExit(f'missing hardening marker: {required}')

if ':latest' in '\n'.join(
    line for line in source.splitlines() if 'DATABASE_URL=$DATABASE_SECRET_ID:' in line
):
    raise SystemExit('unpinned database secret remained')

source_path.write_text(source, encoding='utf-8')

wrapper = r'''#!/usr/bin/env bash
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
]
for marker in required:
    if marker not in text:
        raise SystemExit(f"FAIL_CLOSED: hardened source marker missing: {marker}")
if text.count('DATABASE_URL=$DATABASE_SECRET_ID:$DATABASE_SECRET_VERSION') != 2:
    raise SystemExit("FAIL_CLOSED: expected exactly two pinned database secret references")
if 'DATABASE_URL=$DATABASE_SECRET_ID:latest' in text:
    raise SystemExit("FAIL_CLOSED: unpinned database secret reference present")

sequence = '''validate_command
authenticate_docker
bind_source_asset
build_images
deploy_prepare_job
prepare_request
deploy_execute_job
execute_and_reconcile'''
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
echo "P1_PHASE=DEPLOY_EXECUTE_JOB" >&2
deploy_execute_job
echo "P1_PHASE=EXECUTE_AND_RECONCILE" >&2
execute_and_reconcile'''
sequence_count = text.count(sequence)
if sequence_count != 1:
    raise SystemExit(f"FAIL_CLOSED: expected exactly one canonical execution sequence, found {sequence_count}")
text = text.replace(sequence, instrumented, 1)
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
echo "P1_HARDENED_SOURCE=PASS" >&2

if [ "${PUBLISH_NOW_PATCH_ONLY:-false}" = "true" ]; then
  echo "P1_WRAPPER_PHASE=PATCH_ONLY_COMPLETE" >&2
  exit 0
fi

echo "P1_WRAPPER_PHASE=EXECUTE_HARDENED_SCRIPT" >&2
exec bash "$PATCHED"
'''
wrapper_path.write_text(wrapper, encoding='utf-8')
