#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE="scripts/marketing-publish-now.sh"
PATCHED="$(mktemp)"
trap 'rm -f "$PATCHED"' EXIT

python3 - "$SOURCE" "$PATCHED" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1])
target = Path(sys.argv[2])
text = source.read_text(encoding="utf-8")
needle = '  local extra_json="${2:-{}}"'
replacement = '  local extra_json="${2:-}"\n  [ -n "$extra_json" ] || extra_json=\'{}\''
count = text.count(needle)
if count != 1:
    raise SystemExit(f"FAIL_CLOSED: expected exactly one legacy evidence JSON expansion, found {count}")
patched = text.replace(needle, replacement, 1)
patched = patched.replace(
    'set -Eeuo pipefail',
    'set -Eeuo pipefail\ntrap \'rc=$?; printf "PUBLISH_NOW_FAIL rc=%s line=%s command=%q\\n" "$rc" "${BASH_LINENO[0]:-unknown}" "$BASH_COMMAND" >&2\' ERR',
    1,
)
target.write_text(patched, encoding="utf-8")
PY

chmod 0700 "$PATCHED"
if ! bash -n "$PATCHED"; then
  echo "PUBLISH_NOW_FAIL phase=SYNTAX_CHECK" >&2
  exit 1
fi
exec bash "$PATCHED"
