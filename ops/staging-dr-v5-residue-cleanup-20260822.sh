#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID='toca-mcp-next-staging'
PROJECT_NUMBER='729069789107'
SOURCE_INSTANCE='toca-mcp-next-staging-db'
TARGET_INSTANCE='toca-next-lp-pitr-32567566263'
DR_SA_EMAIL='toca-next-dr-32567566263@toca-mcp-next-staging.iam.gserviceaccount.com'
DR_ROLE_ID='tocaNextDr32567566263'
INFRA_ADMIN_SA='toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com'
ROLE="projects/${PROJECT_ID}/roles/${DR_ROLE_ID}"
MEMBER_DR="serviceAccount:${DR_SA_EMAIL}"
MEMBER_INFRA="serviceAccount:${INFRA_ADMIN_SA}"

[[ "$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')" == "$PROJECT_NUMBER" ]]
[[ "$TARGET_INSTANCE" == toca-next-lp-pitr-* ]]
[[ "$TARGET_INSTANCE" != "$SOURCE_INSTANCE" ]]
gcloud sql instances describe "$SOURCE_INSTANCE" --project="$PROJECT_ID" --format=json >/tmp/v5-clean-source-before.json
jq -e --arg p "$PROJECT_ID" '.project==$p and .name=="toca-mcp-next-staging-db" and .state=="RUNNABLE"' /tmp/v5-clean-source-before.json >/dev/null

if gcloud sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" --format=json >/tmp/v5-clean-target.json 2>/dev/null; then
  PATCHED=0
  for attempt in $(seq 1 90); do
    PROTECTED="$(jq -r '.settings.deletionProtectionEnabled // false' /tmp/v5-clean-target.json)"
    if [[ "$PROTECTED" == false ]]; then
      PATCHED=1
      break
    fi
    if gcloud sql instances patch "$TARGET_INSTANCE" --project="$PROJECT_ID" --no-deletion-protection --quiet >/tmp/v5-clean-patch.out 2>/tmp/v5-clean-patch.err; then
      PATCHED=1
      echo "V5_RESIDUE_DELETION_PROTECTION_DISABLED=PASS attempt=${attempt}"
      break
    fi
    if ! grep -q '409\|another operation was already in progress' /tmp/v5-clean-patch.err; then
      cat /tmp/v5-clean-patch.err >&2
      exit 31
    fi
    sleep 10
    gcloud sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" --format=json >/tmp/v5-clean-target.json
  done
  [[ "$PATCHED" == 1 ]] || { echo 'Timed out disabling target deletion protection' >&2; exit 32; }

  DELETED=0
  for attempt in $(seq 1 90); do
    if gcloud sql instances delete "$TARGET_INSTANCE" --project="$PROJECT_ID" --quiet >/tmp/v5-clean-delete.out 2>/tmp/v5-clean-delete.err; then
      DELETED=1
      echo "V5_RESIDUE_TARGET_DELETE_ACCEPTED=PASS attempt=${attempt}"
      break
    fi
    if ! grep -q '409\|another operation was already in progress' /tmp/v5-clean-delete.err; then
      cat /tmp/v5-clean-delete.err >&2
      exit 33
    fi
    sleep 10
  done
  [[ "$DELETED" == 1 ]] || { echo 'Timed out deleting V5 target' >&2; exit 34; }
fi

for attempt in $(seq 1 90); do
  if ! gcloud sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "V5_RESIDUE_TARGET_ABSENT=PASS attempt=${attempt}"
    break
  fi
  [[ "$attempt" != 90 ]] || { echo 'V5 target still exists after delete' >&2; exit 35; }
  sleep 10
done

POLICY="$(gcloud projects get-iam-policy "$PROJECT_ID" --format=json)"
if jq -e --arg r "$ROLE" --arg m "$MEMBER_DR" 'any(.bindings[]?; .role==$r and any(.members[]?; .==$m))' <<<"$POLICY" >/dev/null; then
  gcloud projects remove-iam-policy-binding "$PROJECT_ID" --member="$MEMBER_DR" --role="$ROLE" --condition=None --quiet >/dev/null
fi
if gcloud iam service-accounts describe "$DR_SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts delete "$DR_SA_EMAIL" --project="$PROJECT_ID" --quiet >/dev/null
fi
if gcloud iam roles describe "$DR_ROLE_ID" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam roles delete "$DR_ROLE_ID" --project="$PROJECT_ID" --quiet >/dev/null
fi
POLICY="$(gcloud projects get-iam-policy "$PROJECT_ID" --format=json)"
if jq -e --arg m "$MEMBER_INFRA" 'any(.bindings[]?; .role=="roles/iam.roleAdmin" and any(.members[]?; .==$m))' <<<"$POLICY" >/dev/null; then
  gcloud projects remove-iam-policy-binding "$PROJECT_ID" --member="$MEMBER_INFRA" --role='roles/iam.roleAdmin' --condition=None --quiet >/dev/null
fi

[[ "$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')" == "$PROJECT_NUMBER" ]]
gcloud sql instances describe "$SOURCE_INSTANCE" --project="$PROJECT_ID" --format=json >/tmp/v5-clean-source-after.json
jq -e --arg p "$PROJECT_ID" '.project==$p and .name=="toca-mcp-next-staging-db" and .state=="RUNNABLE"' /tmp/v5-clean-source-after.json >/dev/null
! gcloud sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1
! gcloud iam service-accounts describe "$DR_SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1
POLICY_AFTER="$(gcloud projects get-iam-policy "$PROJECT_ID" --format=json)"
! jq -e --arg r "$ROLE" --arg m "$MEMBER_DR" 'any(.bindings[]?; .role==$r and any(.members[]?; .==$m))' <<<"$POLICY_AFTER" >/dev/null
! jq -e --arg m "$MEMBER_INFRA" 'any(.bindings[]?; .role=="roles/iam.roleAdmin" and any(.members[]?; .==$m))' <<<"$POLICY_AFTER" >/dev/null

echo 'V5_RESIDUE_CLEANUP=PASS target_absent=true ephemeral_sa_absent=true custom_role_binding_absent=true roleadmin_absent=true source_unchanged=true'
