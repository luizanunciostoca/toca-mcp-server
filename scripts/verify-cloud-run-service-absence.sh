#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${1:?service name required}"
PROJECT_ID="${2:?project id required}"
REGION="${3:?region required}"
GCLOUD_BIN="${GCLOUD_BIN:-gcloud}"

SNAPSHOT="$(mktemp)"
trap 'rm -f "$SNAPSHOT"' EXIT

"$GCLOUD_BIN" run services list \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(metadata.name)' > "$SNAPSHOT"

if grep -Fxq "$SERVICE_NAME" "$SNAPSHOT"; then
  echo "CLOUD_RUN_SERVICE_STILL_PRESENT:$SERVICE_NAME" >&2
  exit 1
fi

echo "CLOUD_RUN_SERVICE_ABSENCE=PASS service=$SERVICE_NAME project=$PROJECT_ID region=$REGION"
