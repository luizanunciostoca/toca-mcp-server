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
