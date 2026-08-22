#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?}"
PROJECT_NUMBER="${PROJECT_NUMBER:?}"
REGION="${REGION:?}"
SOURCE_INSTANCE="${SOURCE_INSTANCE:?}"
CANDIDATE_SHA="${CANDIDATE_SHA:?}"
PRODUCTION_PROJECT_ID="${PRODUCTION_PROJECT_ID:?}"
PRODUCTION_PROJECT_NUMBER="${PRODUCTION_PROJECT_NUMBER:?}"
INFRA_ADMIN_SA="${INFRA_ADMIN_SA:?}"
DR_SA_ID="${DR_SA_ID:?}"
DR_SA_EMAIL="${DR_SA_EMAIL:?}"
DR_ROLE_ID="${DR_ROLE_ID:?}"
TARGET_INSTANCE="${TARGET_INSTANCE:?}"

[[ "$PROJECT_ID" == 'toca-mcp-next-staging' ]]
[[ "$PROJECT_NUMBER" == '729069789107' ]]
[[ "$REGION" == 'southamerica-east1' ]]
[[ "$SOURCE_INSTANCE" == 'toca-mcp-next-staging-db' ]]
[[ "$CANDIDATE_SHA" == '75c165a044c6e79e9545328dd04a2a3e73d2e910' ]]
[[ "$PROJECT_ID" != "$PRODUCTION_PROJECT_ID" ]]
[[ "$PROJECT_NUMBER" != "$PRODUCTION_PROJECT_NUMBER" ]]
[[ "$DR_SA_ID" == toca-next-dr-* ]]
[[ "$DR_SA_EMAIL" == toca-next-dr-*"@toca-mcp-next-staging.iam.gserviceaccount.com" ]]
[[ "$DR_ROLE_ID" == tocaNextDr* ]]
[[ "$TARGET_INSTANCE" == toca-next-lp-pitr-* ]]
[[ "$TARGET_INSTANCE" != "$SOURCE_INSTANCE" ]]

[[ "$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')" == "$PROJECT_NUMBER" ]]
gcloud sql instances describe "$SOURCE_INSTANCE" --project="$PROJECT_ID" --format=json >/tmp/dr-v6-source.json
jq -e --arg p "$PROJECT_ID" --arg r "$REGION" '.project==$p and .region==$r and .name=="toca-mcp-next-staging-db" and .state=="RUNNABLE" and .databaseVersion=="POSTGRES_18" and .settings.backupConfiguration.enabled==true and .settings.backupConfiguration.pointInTimeRecoveryEnabled==true and (.settings.backupConfiguration.transactionLogRetentionDays//0)>=7 and (.settings.backupConfiguration.backupRetentionSettings.retainedBackups//0)>=7' /tmp/dr-v6-source.json >/dev/null
echo 'DR_LP_V6_SOURCE_PREFLIGHT=PASS'

MEMBER_INFRA="serviceAccount:${INFRA_ADMIN_SA}"
POLICY_BEFORE="$(gcloud projects get-iam-policy "$PROJECT_ID" --format=json)"
if jq -e --arg m "$MEMBER_INFRA" 'any(.bindings[]?; .role=="roles/iam.roleAdmin" and any(.members[]?; .==$m))' <<<"$POLICY_BEFORE" >/dev/null; then
  echo 'roles/iam.roleAdmin unexpectedly pre-existed for infra admin' >&2
  exit 20
fi
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="$MEMBER_INFRA" --role='roles/iam.roleAdmin' --condition=None --quiet >/dev/null
echo 'roleadmin_granted=true' >> "${GITHUB_OUTPUT:?}"

if gcloud iam service-accounts describe "$DR_SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo 'Ephemeral DR service account unexpectedly already exists' >&2
  exit 21
fi
gcloud iam service-accounts create "$DR_SA_ID" --project="$PROJECT_ID" --display-name='TOCA Next temporary isolated DR v6' --description="Temporary DR identity for run ${GITHUB_RUN_ID} only" >/dev/null

# Wait for the newly created service-account resource to become readable before
# attempting bindings that validate member existence. This handles IAM eventual
# consistency without broadening permissions or changing the source instance.
SA_VISIBLE=0
for attempt in $(seq 1 60); do
  if gcloud iam service-accounts describe "$DR_SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>/tmp/dr-v6-sa-visible.err; then
    SA_VISIBLE=1
    echo "DR_LP_V6_SERVICE_ACCOUNT_VISIBLE=PASS attempt=${attempt}"
    break
  fi
  sleep 5
done
[[ "$SA_VISIBLE" == 1 ]] || { tail -n 20 /tmp/dr-v6-sa-visible.err >&2 || true; exit 26; }

PERMISSIONS='cloudsql.instances.clone,cloudsql.instances.connect,cloudsql.instances.create,cloudsql.instances.delete,cloudsql.instances.get,cloudsql.instances.update,cloudsql.operations.get,cloudsql.users.list,cloudsql.users.update,resourcemanager.projects.get,serviceusage.services.use'
gcloud iam roles create "$DR_ROLE_ID" --project="$PROJECT_ID" --title='TOCA Next isolated DR least privilege v6' --description="Temporary DR-only role for run ${GITHUB_RUN_ID}" --permissions="$PERMISSIONS" --stage=GA --quiet >/dev/null
gcloud iam roles describe "$DR_ROLE_ID" --project="$PROJECT_ID" --format=json >/tmp/dr-v6-role.json
[[ "$(jq -r '.includedPermissions[]' /tmp/dr-v6-role.json | sort)" == "$(tr ',' '\n' <<<"$PERMISSIONS" | sort)" ]]

gcloud iam service-accounts add-iam-policy-binding "$DR_SA_EMAIL" --project="$PROJECT_ID" --member="$MEMBER_INFRA" --role='roles/iam.serviceAccountTokenCreator' --condition=None --quiet >/dev/null
ROLE="projects/${PROJECT_ID}/roles/${DR_ROLE_ID}"
MEMBER_DR="serviceAccount:${DR_SA_EMAIL}"

# Project-level binding can lag behind service-account creation even after the
# service-account GET is visible. Retry only the exact temporary member/role.
BINDING_READY=0
for attempt in $(seq 1 60); do
  set +e
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="$MEMBER_DR" --role="$ROLE" --condition=None --quiet >/tmp/dr-v6-binding.out 2>/tmp/dr-v6-binding.err
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    BINDING_READY=1
    echo "DR_LP_V6_PROJECT_BINDING=PASS attempt=${attempt}"
    break
  fi
  if ! grep -Eqi 'does not exist|INVALID_ARGUMENT|Policy modification failed|not found' /tmp/dr-v6-binding.err; then
    cat /tmp/dr-v6-binding.err >&2
    exit "$rc"
  fi
  sleep 5
done
[[ "$BINDING_READY" == 1 ]] || { tail -n 20 /tmp/dr-v6-binding.err >&2 || true; exit 27; }

POLICY="$(gcloud projects get-iam-policy "$PROJECT_ID" --format=json)"
jq -e --arg r "$ROLE" --arg m "$MEMBER_DR" 'any(.bindings[]?; .role==$r and any(.members[]?; .==$m))' <<<"$POLICY" >/dev/null
for forbidden in roles/owner roles/editor roles/cloudsql.admin roles/run.admin roles/secretmanager.admin; do
  if jq -e --arg r "$forbidden" --arg m "$MEMBER_DR" 'any(.bindings[]?; .role==$r and any(.members[]?; .==$m))' <<<"$POLICY" >/dev/null; then
    echo "Forbidden broad role bound to ephemeral DR identity: $forbidden" >&2
    exit 22
  fi
done

READY=0
for attempt in $(seq 1 60); do
  if gcloud --impersonate-service-account="$DR_SA_EMAIL" projects describe "$PROJECT_ID" --format='value(projectNumber)' >/tmp/dr-v6-project 2>/tmp/dr-v6-imp-error \
    && [[ "$(cat /tmp/dr-v6-project)" == "$PROJECT_NUMBER" ]] \
    && gcloud --impersonate-service-account="$DR_SA_EMAIL" sql instances describe "$SOURCE_INSTANCE" --project="$PROJECT_ID" --format='value(state)' >/tmp/dr-v6-source-state 2>>/tmp/dr-v6-imp-error \
    && [[ "$(cat /tmp/dr-v6-source-state)" == RUNNABLE ]]; then
    READY=1
    echo "DR_LP_V6_IMPERSONATION=PASS attempt=${attempt}"
    break
  fi
  sleep 10
done
[[ "$READY" == 1 ]] || { tail -n 20 /tmp/dr-v6-imp-error >&2 || true; exit 23; }

TOKEN="$(gcloud auth print-access-token --impersonate-service-account="$DR_SA_EMAIL")"
printf '%s' '{"permissions":["cloudsql.instances.clone","cloudsql.instances.connect","cloudsql.instances.create","cloudsql.instances.delete","cloudsql.instances.get","cloudsql.instances.update","cloudsql.operations.get","cloudsql.users.list","cloudsql.users.update","resourcemanager.projects.get","serviceusage.services.use"]}' >/tmp/dr-v6-test-perms-request.json
HTTP="$(curl --silent --show-error --output /tmp/dr-v6-test-perms.json --write-out '%{http_code}' -X POST -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' --data-binary @/tmp/dr-v6-test-perms-request.json "https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:testIamPermissions")"
unset TOKEN
[[ "$HTTP" == 200 ]] || { cat /tmp/dr-v6-test-perms.json >&2; exit 24; }
for p in cloudsql.instances.clone cloudsql.instances.connect cloudsql.instances.create cloudsql.instances.delete cloudsql.instances.get cloudsql.instances.update cloudsql.operations.get cloudsql.users.list cloudsql.users.update resourcemanager.projects.get serviceusage.services.use; do
  jq -e --arg p "$p" '(.permissions // []) | index($p) != null' /tmp/dr-v6-test-perms.json >/dev/null || { echo "DR_LP_V6_MISSING_PERMISSION=$p" >&2; exit 25; }
done
echo 'DR_LP_V6_TEST_IAM_PERMISSIONS=PASS permissions=11'
echo 'DR_LP_V6_BOOTSTRAP=PASS'
