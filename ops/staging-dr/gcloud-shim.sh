#!/usr/bin/env bash
set -euo pipefail

REAL_GCLOUD="${REAL_GCLOUD:?REAL_GCLOUD required}"
DR_SA_EMAIL="${DR_SA_EMAIL:?DR_SA_EMAIL required}"
PROJECT_ID="${PROJECT_ID:?PROJECT_ID required}"
SOURCE_INSTANCE="${SOURCE_INSTANCE:?SOURCE_INSTANCE required}"
TARGET_INSTANCE="${TARGET_INSTANCE:?TARGET_INSTANCE required}"

raw_args=("$@")
args=("${raw_args[@]}")

# The harness invokes gcloud with a global impersonation flag before the command.
# Normalize only for command matching; retain the original argv for delegated calls.
if [[ ${#args[@]} -ge 1 && "${args[0]}" == --impersonate-service-account=* ]]; then
  [[ "${args[0]#--impersonate-service-account=}" == "$DR_SA_EMAIL" ]]
  args=("${args[@]:1}")
elif [[ ${#args[@]} -ge 2 && "${args[0]}" == '--impersonate-service-account' ]]; then
  [[ "${args[1]}" == "$DR_SA_EMAIL" ]]
  args=("${args[@]:2}")
fi

run_with_409_retry() {
  local label="$1"; shift
  local out="/tmp/dr-v9-${label}.out"
  local err="/tmp/dr-v9-${label}.err"
  for attempt in $(seq 1 120); do
    if "$REAL_GCLOUD" "$@" >"$out" 2>"$err"; then
      cat "$out"
      echo "DR_LP_V9_${label^^}_PASS attempt=${attempt}" >&2
      return 0
    fi
    if ! grep -Eq '409|another operation was already in progress|taking longer than expected' "$err"; then
      cat "$err" >&2
      return 1
    fi
    sleep 10
  done
  echo "Timed out retrying ${label} after transient Cloud SQL operation contention" >&2
  cat "$err" >&2 || true
  return 1
}

# Clone through the REST endpoint and return immediately after the API accepts
# the exact isolated target. The harness itself polls the target to RUNNABLE.
if [[ ${#args[@]} -ge 5 && "${args[0]}" == sql && "${args[1]}" == instances && "${args[2]}" == clone ]]; then
  source_arg="${args[3]}"
  target_arg="${args[4]}"
  [[ "$source_arg" == "$SOURCE_INSTANCE" ]]
  [[ "$target_arg" == "$TARGET_INSTANCE" ]]
  request_project=''
  point_in_time=''
  for ((i=0; i<${#args[@]}; i++)); do
    case "${args[$i]}" in
      --project=*) request_project="${args[$i]#--project=}" ;;
      --project) request_project="${args[$((i+1))]:-}" ;;
      --point-in-time=*) point_in_time="${args[$i]#--point-in-time=}" ;;
      --point-in-time) point_in_time="${args[$((i+1))]:-}" ;;
    esac
  done
  [[ "$request_project" == "$PROJECT_ID" ]]
  [[ -n "$point_in_time" ]]
  [[ "$TARGET_INSTANCE" == toca-next-lp-pitr-* ]]
  [[ "$TARGET_INSTANCE" != "$SOURCE_INSTANCE" ]]

  TOKEN="$($REAL_GCLOUD auth print-access-token --impersonate-service-account="$DR_SA_EMAIL")"
  jq -n --arg target "$TARGET_INSTANCE" --arg point "$point_in_time" '{cloneContext:{kind:"sql#cloneContext",destinationInstanceName:$target,pointInTime:$point}}' >/tmp/dr-v9-clone-request.json
  HTTP="$(curl --silent --show-error --output /tmp/dr-v9-clone-response.json --write-out '%{http_code}' -X POST -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json; charset=utf-8' --data-binary @/tmp/dr-v9-clone-request.json "https://sqladmin.googleapis.com/v1/projects/${PROJECT_ID}/instances/${SOURCE_INSTANCE}/clone")"
  unset TOKEN

  if [[ "$HTTP" != 200 ]]; then
    echo "DR_LP_V9_REST_CLONE_HTTP=$HTTP" >&2
    jq '{error:{code:.error.code,status:.error.status,message:.error.message,details:(.error.details // [])}}' /tmp/dr-v9-clone-response.json >&2 2>/dev/null || cat /tmp/dr-v9-clone-response.json >&2
    exit 70
  fi
  jq -e --arg p "$PROJECT_ID" --arg t "$TARGET_INSTANCE" '(.name|length)>0 and .targetProject==$p and .targetId==$t and (.operationType=="CLONE" or .operationType=="CREATE")' /tmp/dr-v9-clone-response.json >/dev/null
  echo "DR_LP_V9_REST_CLONE_ACCEPTED=PASS operation=$(jq -r '.name' /tmp/dr-v9-clone-response.json)" >&2
  cat /tmp/dr-v9-clone-response.json
  exit 0
fi

# Retry only exact temporary-target mutations that can legitimately race with
# the clone operation's internal lock release.
if [[ ${#args[@]} -ge 3 && "${args[0]}" == sql && "${args[1]}" == users && "${args[2]}" == set-password ]]; then
  joined=" ${args[*]} "
  [[ "$joined" == *" --instance=${TARGET_INSTANCE} "* || "$joined" == *" --instance ${TARGET_INSTANCE} "* ]]
  run_with_409_retry set_password "${raw_args[@]}"
  exit $?
fi

if [[ ${#args[@]} -ge 4 && "${args[0]}" == sql && "${args[1]}" == instances && "${args[2]}" == patch && "${args[3]}" == "$TARGET_INSTANCE" ]]; then
  run_with_409_retry patch "${raw_args[@]}"
  exit $?
fi

if [[ ${#args[@]} -ge 4 && "${args[0]}" == sql && "${args[1]}" == instances && "${args[2]}" == delete && "${args[3]}" == "$TARGET_INSTANCE" ]]; then
  run_with_409_retry delete "${raw_args[@]}"
  exit $?
fi

exec "$REAL_GCLOUD" "${raw_args[@]}"
