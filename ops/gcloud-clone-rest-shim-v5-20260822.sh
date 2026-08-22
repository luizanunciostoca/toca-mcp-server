#!/usr/bin/env bash
set -euo pipefail

REAL_GCLOUD="${REAL_GCLOUD:?REAL_GCLOUD required}"
DR_SA_EMAIL="${DR_SA_EMAIL:?DR_SA_EMAIL required}"
PROJECT_ID="${PROJECT_ID:?PROJECT_ID required}"
SOURCE_INSTANCE="${SOURCE_INSTANCE:?SOURCE_INSTANCE required}"
TARGET_INSTANCE="${TARGET_INSTANCE:?TARGET_INSTANCE required}"

is_clone=0
clone_index=-1
args=("$@")
for ((i=0; i<${#args[@]}-2; i++)); do
  if [[ "${args[$i]}" == 'sql' && "${args[$((i+1))]}" == 'instances' && "${args[$((i+2))]}" == 'clone' ]]; then
    is_clone=1
    clone_index=$((i+2))
    break
  fi
done

if [[ "$is_clone" != 1 ]]; then
  exec "$REAL_GCLOUD" "$@"
fi

source_arg="${args[$((clone_index+1))]:-}"
target_arg="${args[$((clone_index+2))]:-}"
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
jq -n --arg target "$TARGET_INSTANCE" --arg point "$point_in_time" '{cloneContext:{kind:"sql#cloneContext",destinationInstanceName:$target,pointInTime:$point}}' >/tmp/dr-v5-clone-request.json
HTTP="$(curl --silent --show-error --output /tmp/dr-v5-clone-response.json --write-out '%{http_code}' -X POST -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json; charset=utf-8' --data-binary @/tmp/dr-v5-clone-request.json "https://sqladmin.googleapis.com/v1/projects/${PROJECT_ID}/instances/${SOURCE_INSTANCE}/clone")"
unset TOKEN
if [[ "$HTTP" != 200 ]]; then
  echo "DR_LP_V5_REST_CLONE_HTTP=$HTTP" >&2
  jq '{error:{code:.error.code,status:.error.status,message:.error.message,details:(.error.details // [])}}' /tmp/dr-v5-clone-response.json >&2 2>/dev/null || cat /tmp/dr-v5-clone-response.json >&2
  exit 70
fi
jq -e --arg project "$PROJECT_ID" --arg target "$TARGET_INSTANCE" '(.name|length)>0 and .targetProject==$project and .targetId==$target and (.operationType=="CLONE" or .operationType=="CREATE")' /tmp/dr-v5-clone-response.json >/dev/null
echo 'DR_LP_V5_REST_CLONE_ACCEPTED=PASS'
cat /tmp/dr-v5-clone-response.json
