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

legacy = '  local extra_json="${2:-{}}"'
fixed = '  local extra_json="${2:-}"\n  [ -n "$extra_json" ] || extra_json=\'{}\''
legacy_count = text.count(legacy)
if legacy_count != 1:
    raise SystemExit(f"FAIL_CLOSED: expected exactly one legacy evidence JSON expansion, found {legacy_count}")
text = text.replace(legacy, fixed, 1)

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

echo "P1_WRAPPER_PHASE=PATCH_GENERATED" >&2
chmod 0700 "$PATCHED"
bash -n "$PATCHED"
grep -Fq 'local extra_json="${2:-}"' "$PATCHED"
grep -Fq 'P1_PHASE=VALIDATE_COMMAND' "$PATCHED"
echo "P1_COMPAT_PATCH=PASS" >&2

if [ "${PUBLISH_NOW_PATCH_ONLY:-false}" = "true" ]; then
  echo "P1_WRAPPER_PHASE=PATCH_ONLY_COMPLETE" >&2
  exit 0
fi

echo "P1_WRAPPER_PHASE=EXECUTE_PATCHED_SCRIPT" >&2
exec bash "$PATCHED"
