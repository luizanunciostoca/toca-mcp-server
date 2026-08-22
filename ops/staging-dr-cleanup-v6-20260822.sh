#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?}"
PROJECT_NUMBER="${PROJECT_NUMBER:?}"
REGION="${REGION:?}"
SOURCE_INSTANCE="${SOURCE_INSTANCE:?}"
PRODUCTION_PROJECT_ID="${PRODUCTION_PROJECT_ID:?}"
PRODUCTION_PROJECT_NUMBER="${PRODUCTION_PROJECT_NUMBER:?}"
INFRA_ADMIN_SA="${INFRA_ADMIN_SA:?}"
DR_SA_ID="${DR_SA_ID:?}"
DR_SA_EMAIL="${DR_SA_EMAIL:?}"
DR_ROLE_ID="${DR_ROLE_ID:?}"
TARGET_INSTANCE="${TARGET_INSTANCE:?}"
ROLEADMIN_GRANTED="${ROLEADMIN_GRANTED:-false}"
RUN_ID="${GITHUB_RUN_ID:?}"

[[ "$PROJECT_ID" == 'toca-mcp-next-staging' ]]
[[ "$PROJECT_NUMBER" == '729069789107' ]]
[[ "$REGION" == 'southamerica-east1' ]]
[[ "$SOURCE_INSTANCE" == 'toca-mcp-next-staging-db' ]]
[[ "$PROJECT_ID" != "$PRODUCTION_PROJECT_ID" ]]
[[ "$PROJECT_NUMBER" != "$PRODUCTION_PROJECT_NUMBER" ]]
[[ "$DR_SA_ID" == "toca-next-dr-${RUN_ID}" ]]
[[ "$DR_SA_EMAIL" == "toca-next-dr-${RUN_ID}@toca-mcp-next-staging.iam.gserviceaccount.com" ]]
[[ "$DR_ROLE_ID" == "tocaNextDr${RUN_ID}" ]]
[[ "$TARGET_INSTANCE" == "toca-next-lp-pitr-${RUN_ID}" ]]
[[ "$TARGET_INSTANCE" != "$SOURCE_INSTANCE" ]]
[[ "$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')" == "$PROJECT_NUMBER" ]]

gcloud sql instances describe "$SOURCE_INSTANCE" --project="$PROJECT_ID" --format=json >/tmp/v6-clean-source-before.json
jq -e --arg p "$PROJECT_ID" --arg r "$REGION" '.project==$p and .region==$r and .name=="toca-mcp-next-staging-db" and .state=="RUNNABLE" and .databaseVersion=="POSTGRES_18" and .settings.backupConfiguration.enabled==true and .settings.backupConfiguration.pointInTimeRecoveryEnabled==true' /tmp/v6-clean-source-before.json >/dev/null

retry_409() {
  local label="$1"
  shift
  local attempt out rc
  for attempt in $(seq 1 120); do
    set +e
    out="$("$@" 2>&1)"
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      echo "${label}=PASS attempt=${attempt}"
      return 0
    fi
    if grep -Eq 'HTTPError 409|another operation was already in progress|operation.*in progress' <<<"$out"; then
      sleep 10
      continue
    fi
    printf '%s\n' "$out" >&2
    return "$rc"
  done
  echo "${label}=TIMEOUT" >&2
  return 124
}

if gcloud sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" --format=json >/tmp/v6-clean-target.json 2>/dev/null; then
  jq -e --arg p "$PROJECT_ID" --arg r "$REGION" --arg t "$TARGET_INSTANCE" '.project==$p and .region==$r and .name==$t and .databaseVersion=="POSTGRES_18"' /tmp/v6-clean-target.json >/dev/null
  if [[ "$(jq -r '.settings.deletionProtectionEnabled // false' /tmp/v6-clean-target.json)" == true ]]; then
    retry_409 DR_V6_CLEANUP_DELETION_PROTECTION gcloud sql instances patch "$TARGET_INSTANCE" --project="$PROJECT_ID" --no-deletion-protection --quiet
  else
    echo 'DR_V6_CLEANUP_DELETION_PROTECTION=ALREADY_DISABLED'
  fi

  DELETED=0
  for attempt in $(seq 1 120); do
    if ! gcloud sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1; then
      DELETED=1
      echo "DR_V6_CLEANUP_TARGET_ABSENT=PASS attempt=${attempt}"
      break
    fi
    set +e
    out="$(gcloud sql instances delete "$TARGET_INSTANCE" --project="$PROJECT_ID" --quiet 2>&1)"
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      for check in $(seq 1 120); do
        if ! gcloud sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1; then
          DELETED=1
          break
        fi
        sleep 5
      done
      [[ "$DELETED" == 1 ]] || { echo 'V6 target remained visible after successful delete command' >&2; exit 41; }
      echo "DR_V6_CLEANUP_TARGET_DELETE=PASS attempt=${attempt}"
      break
    fi
    if grep -Eq 'HTTPError 409|another operation was already in progress|operation.*in progress' <<<"$out"; then
      sleep 10
      continue
    fi
    printf '%s\n' "$out" >&2
    exit "$rc"
  done
  [[ "$DELETED" == 1 ]] || { echo 'Timed out deleting V6 target' >&2; exit 42; }
else
  echo 'DR_V6_CLEANUP_TARGET=ALREADY_ABSENT'
fi

ROLE="projects/${PROJECT_ID}/roles/${DR_ROLE_ID}"
MEMBER_DR="serviceAccount:${DR_SA_EMAIL}"
MEMBER_INFRA="serviceAccount:${INFRA_ADMIN_SA}"
POLICY="$(gcloud projects get-iam-policy "$PROJECT_ID" --format=json)"
if jq -e --arg r "$ROLE" --arg m "$MEMBER_DR" 'any(.bindings[]?; .role==$r and any(.members[]?; .==$m))' <<<"$POLICY" >/dev/null; then
  gcloud projects remove-iam-policy-binding "$PROJECT_ID" --member="$MEMBER_DR" --role="$ROLE" --condition=None --quiet >/dev/null
fi

if gcloud iam service-accounts describe "$DR_SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  SA_POLICY="$(gcloud iam service-accounts get-iam-policy "$DR_SA_EMAIL" --project="$PROJECT_ID" --format=json)"
  if jq -e --arg m "$MEMBER_INFRA" 'any(.bindings[]?; .role=="roles/iam.serviceAccountTokenCreator" and any(.members[]?; .==$m))' <<<"$SA_POLICY" >/dev/null; then
    gcloud iam service-accounts remove-iam-policy-binding "$DR_SA_EMAIL" --project="$PROJECT_ID" --member="$MEMBER_INFRA" --role='roles/iam.serviceAccountTokenCreator' --condition=None --quiet >/dev/null
  fi
  gcloud iam service-accounts delete "$DR_SA_EMAIL" --project="$PROJECT_ID" --quiet >/dev/null
fi

if gcloud iam roles describe "$DR_ROLE_ID" --project="$PROJECT_ID" >/dev/null 2>&1; then
  ROLE_DELETED=0
  for attempt in $(seq 1 30); do
    set +e
    out="$(gcloud iam roles delete "$DR_ROLE_ID" --project="$PROJECT_ID" --quiet 2>&1)"
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      ROLE_DELETED=1
      break
    fi
    if grep -Eqi '409|FAILED_PRECONDITION|in use|currently being used' <<<"$out"; then
      sleep 5
      continue
    fi
    printf '%s\n' "$out" >&2
    exit "$rc"
  done
  [[ "$ROLE_DELETED" == 1 ]] || { echo 'Timed out deleting V6 custom role' >&2; exit 43; }
fi

if [[ "$ROLEADMIN_GRANTED" == true ]]; then
  POLICY="$(gcloud projects get-iam-policy "$PROJECT_ID" --format=json)"
  if jq -e --arg m "$MEMBER_INFRA" 'any(.bindings[]?; .role=="roles/iam.roleAdmin" and any(.members[]?; .==$m))' <<<"$POLICY" >/dev/null; then
    gcloud projects remove-iam-policy-binding "$PROJECT_ID" --member="$MEMBER_INFRA" --role='roles/iam.roleAdmin' --condition=None --quiet >/dev/null
  fi
fi

! gcloud sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1
! gcloud iam service-accounts describe "$DR_SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1
! gcloud iam roles describe "$DR_ROLE_ID" --project="$PROJECT_ID" >/dev/null 2>&1
POLICY_FINAL="$(gcloud projects get-iam-policy "$PROJECT_ID" --format=json)"
! jq -e --arg r "$ROLE" --arg m "$MEMBER_DR" 'any(.bindings[]?; .role==$r and any(.members[]?; .==$m))' <<<"$POLICY_FINAL" >/dev/null
if [[ "$ROLEADMIN_GRANTED" == true ]]; then
  ! jq -e --arg m "$MEMBER_INFRA" 'any(.bindings[]?; .role=="roles/iam.roleAdmin" and any(.members[]?; .==$m))' <<<"$POLICY_FINAL" >/dev/null
fi

gcloud sql instances describe "$SOURCE_INSTANCE" --project="$PROJECT_ID" --format=json >/tmp/v6-clean-source-after.json
jq -e --arg p "$PROJECT_ID" --arg r "$REGION" '.project==$p and .region==$r and .name=="toca-mcp-next-staging-db" and .state=="RUNNABLE" and .databaseVersion=="POSTGRES_18" and .settings.backupConfiguration.enabled==true and .settings.backupConfiguration.pointInTimeRecoveryEnabled==true' /tmp/v6-clean-source-after.json >/dev/null

echo 'DR_V6_CLEANUP=PASS target_absent=true temp_sa_absent=true temp_role_absent=true temp_binding_absent=true source_unchanged=true'
