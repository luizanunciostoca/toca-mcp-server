#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-ASSERT}"
GUARD_PROFILE="${INSTAGRAM_FAQ_GUARD_PROFILE:-FAQ_EXPANSION_REFRESH}"
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_REPOSITORY_OWNER:?GITHUB_REPOSITORY_OWNER is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${AUTHORIZATION_ISSUE:?AUTHORIZATION_ISSUE is required}"
: "${ENGAGEMENT_RESERVATION:?ENGAGEMENT_RESERVATION is required}"

CONTROL_ISSUE=640

release_reservation() {
  local control_json control_body updated_body
  control_json="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${CONTROL_ISSUE}")"
  control_body="$(jq -r '.body // ""' <<< "$control_json")"
  if ! grep -Fxq "MERGE_RESERVATION=$ENGAGEMENT_RESERVATION" <<< "$control_body"; then
    echo 'ENGAGEMENT_PRODUCTION_RESERVATION_RELEASE=NOT_HELD'
    return 0
  fi
  updated_body="$(printf '%s' "$control_body" \
    | sed "s/^MERGE_RESERVATION=${ENGAGEMENT_RESERVATION}$/MERGE_RESERVATION=NONE/" \
    | sed "s/\"mergeReservation\":\"${ENGAGEMENT_RESERVATION}\"/\"mergeReservation\":null/")"
  gh api --method PATCH "repos/${GITHUB_REPOSITORY}/issues/${CONTROL_ISSUE}" \
    -f body="$updated_body" >/dev/null
  control_body="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${CONTROL_ISSUE}" --jq '.body // ""')"
  grep -Fxq 'MERGE_RESERVATION=NONE' <<< "$control_body"
  echo 'ENGAGEMENT_PRODUCTION_RESERVATION_RELEASE=PASS'
}

if [[ "$MODE" == 'RELEASE' ]]; then
  release_reservation
  exit 0
fi
if [[ "$MODE" != 'ACQUIRE' && "$MODE" != 'ASSERT' ]]; then
  echo "Unsupported guard mode: $MODE" >&2
  exit 1
fi

case "$GUARD_PROFILE" in
  FAQ_EXPANSION_REFRESH)
    : "${FAQ_EXPECTED_COUNT:?FAQ_EXPECTED_COUNT is required}"
    : "${KB_SOURCE_IDS:?KB_SOURCE_IDS is required}"
    TITLE_PREFIX='PRODUCTION AUTHORIZATION — Instagram FAQ expansion LIMITED refresh AUTO'
    ;;
  FAQ_KNOWLEDGE_RECOVERY)
    TITLE_PREFIX='PRODUCTION AUTHORIZATION — Instagram FAQ knowledge RECOVERY AUTO'
    ;;
  *)
    echo "Unsupported FAQ production guard profile: $GUARD_PROFILE" >&2
    exit 1
    ;;
esac

ISSUE_JSON="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${AUTHORIZATION_ISSUE}")"
jq -e --arg owner "$GITHUB_REPOSITORY_OWNER" --arg prefix "$TITLE_PREFIX" '
  .state == "open" and
  .user.login == $owner and
  (.title | startswith($prefix))
' <<< "$ISSUE_JSON" >/dev/null
BODY="$(jq -r '.body // ""' <<< "$ISSUE_JSON")"
RUNTIME_DIGEST="$(grep '^RUNTIME_IMAGE_DIGEST=' <<< "$BODY" | tail -1 | cut -d= -f2-)"
[[ "$RUNTIME_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]

if [[ "$GUARD_PROFILE" == 'FAQ_EXPANSION_REFRESH' ]]; then
  required=(
    "AUTHORIZED_CONTROLLER_SHA=$GITHUB_SHA"
    'AUTHORIZATION_STATE=ACTIVE'
    'INSTAGRAM_FAQ_EXPANSION_LIMITED_REFRESH=AUTHORIZED'
    "RUNTIME_SOURCE_SHA=$GITHUB_SHA"
    "RUNTIME_IMAGE_DIGEST=$RUNTIME_DIGEST"
    'AUTONOMY_STAGE=LIMITED'
    'AUTO_REPLY_CHANNELS=DIRECT,COMMENT'
    'CURRENT_LIMITED_STATE_REQUIRED=true'
    'PERSISTENT_WRITES_AUTHORIZED=true'
    'DATABASE_MIGRATIONS_AUTHORIZED=true'
    'SERVICE_MUTATION_AUTHORIZED=true'
    'SCHEDULER_MUTATION_AUTHORIZED=false'
    'GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false'
    "FAQ_EXPECTED_COUNT=$FAQ_EXPECTED_COUNT"
    "KB_SOURCE_IDS=$KB_SOURCE_IDS"
    'ZERO_TRAFFIC_STAGE_REQUIRED=true'
    'BATCH_SIZE=1'
    'ROLLBACK_ON_FAILURE=true'
  )
else
  BACKUP_KEY="$(grep '^BACKUP_KEY=' <<< "$BODY" | tail -1 | cut -d= -f2-)"
  EXPECTED_ACTIVE_REVISION="$(grep '^EXPECTED_ACTIVE_REVISION=' <<< "$BODY" | tail -1 | cut -d= -f2-)"
  [[ "$BACKUP_KEY" =~ ^[0-9]+_[0-9]+$ ]]
  [[ "$EXPECTED_ACTIVE_REVISION" =~ ^toca-managed-instagram-daemon-[a-z0-9-]+$ ]]
  required=(
    "AUTHORIZED_CONTROLLER_SHA=$GITHUB_SHA"
    'AUTHORIZATION_STATE=ACTIVE'
    'INSTAGRAM_FAQ_EXPANSION_KNOWLEDGE_RECOVERY=AUTHORIZED'
    "RUNTIME_SOURCE_SHA=$GITHUB_SHA"
    "RUNTIME_IMAGE_DIGEST=$RUNTIME_DIGEST"
    "BACKUP_KEY=$BACKUP_KEY"
    "EXPECTED_ACTIVE_REVISION=$EXPECTED_ACTIVE_REVISION"
    'DATABASE_MUTATIONS_AUTHORIZED=true'
    'SERVICE_DEPLOY_AUTHORIZED=false'
    'SCHEDULER_MUTATION_AUTHORIZED=false'
    'PROVIDER_WRITES_AUTHORIZED=false'
    'EXTERNAL_REPLY_WRITES_AUTHORIZED=false'
    'GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false'
  )
fi
for line in "${required[@]}"; do
  grep -Fxq "$line" <<< "$BODY" || {
    echo "Live authorization marker missing: $line" >&2
    exit 1
  }
done

CURRENT_MAIN_SHA="$(gh api "repos/${GITHUB_REPOSITORY}/branches/main" --jq '.commit.sha')"
test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"

CONTROL_JSON="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${CONTROL_ISSUE}")"
jq -e --arg owner "$GITHUB_REPOSITORY_OWNER" '
  .state == "open" and .user.login == $owner
' <<< "$CONTROL_JSON" >/dev/null
CONTROL_BODY="$(jq -r '.body // ""' <<< "$CONTROL_JSON")"
control_required=(
  'PRO_PLUS_CONTROL_PLANE_SCHEMA_VERSION=2'
  'CONTROL_PLANE_ROLE=INTEGRATION_QUEUE_AND_MAIN_STABILITY'
  'MAIN_STABILITY=PASS'
  "EVALUATED_MAIN_SHA=$GITHUB_SHA"
  'ENGAGEMENT_AUTONOMY_STAGE=LIMITED'
  'ENGAGEMENT_AUTO_REPLY_CHANNELS=DIRECT,COMMENT'
  'DIRECT_LIMITED_RUNTIME_ACTIVE=true'
  'COMMENT_LIMITED_RUNTIME_ACTIVE=true'
  'GENERAL_AUTONOMY=false'
)
for line in "${control_required[@]}"; do
  grep -Fxq "$line" <<< "$CONTROL_BODY" || {
    echo "Control-plane marker missing: $line" >&2
    exit 1
  }
done

if [[ "$MODE" == 'ASSERT' ]]; then
  grep -Fxq "MERGE_RESERVATION=$ENGAGEMENT_RESERVATION" <<< "$CONTROL_BODY"
  echo 'ENGAGEMENT_PRODUCTION_GUARD=PASS'
  echo "RUNTIME_IMAGE_DIGEST=$RUNTIME_DIGEST"
  if [[ "$GUARD_PROFILE" == 'FAQ_KNOWLEDGE_RECOVERY' ]]; then
    echo "BACKUP_KEY=$BACKUP_KEY"
    echo "EXPECTED_ACTIVE_REVISION=$EXPECTED_ACTIVE_REVISION"
  fi
  exit 0
fi

test "$(grep -Fxc 'MERGE_RESERVATION=NONE' <<< "$CONTROL_BODY" || true)" = '1'
UPDATED_BODY="$(printf '%s' "$CONTROL_BODY" \
  | sed "s/^MERGE_RESERVATION=NONE$/MERGE_RESERVATION=${ENGAGEMENT_RESERVATION}/" \
  | sed "s/\"mergeReservation\":null/\"mergeReservation\":\"${ENGAGEMENT_RESERVATION}\"/")"
gh api --method PATCH "repos/${GITHUB_REPOSITORY}/issues/${CONTROL_ISSUE}" \
  -f body="$UPDATED_BODY" >/dev/null
CONTROL_BODY="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${CONTROL_ISSUE}" --jq '.body // ""')"
grep -Fxq "MERGE_RESERVATION=$ENGAGEMENT_RESERVATION" <<< "$CONTROL_BODY"

conflicts=0
for status in in_progress queued; do
  RUNS="$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs?status=${status}&per_page=100")"
  count="$(jq --argjson self "$GITHUB_RUN_ID" '[
    .workflow_runs[]
    | select(.id != $self)
    | select(.event == "issues")
    | select(.head_branch == "main")
    | select(
        .path == ".github/workflows/instagram-engagement-limited-activation.yml" or
        .path == ".github/workflows/instagram-engagement-limited-runtime-refresh.yml" or
        .path == ".github/workflows/instagram-engagement-comment-limited-promotion.yml" or
        .path == ".github/workflows/instagram-engagement-tiered-knowledge-shadow.yml" or
        .path == ".github/workflows/instagram-engagement-shadow-production.yml" or
        .path == ".github/workflows/instagram-engagement-faq-expansion-limited-refresh.yml" or
        .path == ".github/workflows/instagram-engagement-faq-knowledge-recovery.yml"
      )
  ] | length' <<< "$RUNS")"
  conflicts=$((conflicts + count))
done
if (( conflicts > 0 )); then
  echo "Competing engagement production mutation runs detected: $conflicts" >&2
  release_reservation
  exit 1
fi

# Re-read the shared state after the conflict scan so this run proves it still owns the reservation.
CONTROL_BODY="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${CONTROL_ISSUE}" --jq '.body // ""')"
grep -Fxq "MERGE_RESERVATION=$ENGAGEMENT_RESERVATION" <<< "$CONTROL_BODY"

echo 'ENGAGEMENT_PRODUCTION_RESERVATION_ACQUIRE=PASS'
echo "RUNTIME_IMAGE_DIGEST=$RUNTIME_DIGEST"
if [[ "$GUARD_PROFILE" == 'FAQ_KNOWLEDGE_RECOVERY' ]]; then
  echo "BACKUP_KEY=$BACKUP_KEY"
  echo "EXPECTED_ACTIVE_REVISION=$EXPECTED_ACTIVE_REVISION"
fi
