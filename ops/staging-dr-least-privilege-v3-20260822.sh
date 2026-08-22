#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
CANDIDATE_DIR="${2:-candidate}"

required=(PROJECT_ID PROJECT_NUMBER REGION SOURCE_INSTANCE CANDIDATE_SHA PRODUCTION_PROJECT_ID PRODUCTION_PROJECT_NUMBER INFRA_ADMIN_SA DR_SA_ID DR_SA_EMAIL DR_ROLE_ID TARGET_INSTANCE)
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "Missing env: $name" >&2; exit 1; }
done

assert_boundary() {
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
}

gc() { gcloud "$@"; }
drgc() { gcloud --impersonate-service-account="$DR_SA_EMAIL" "$@"; }

source_preflight_direct() {
  gc sql instances describe "$SOURCE_INSTANCE" --project="$PROJECT_ID" --format=json > /tmp/source.json
  jq -e --arg project "$PROJECT_ID" --arg region "$REGION" '
    .project==$project and .region==$region and .name=="toca-mcp-next-staging-db" and
    .state=="RUNNABLE" and .databaseVersion=="POSTGRES_18" and
    .settings.backupConfiguration.enabled==true and
    .settings.backupConfiguration.pointInTimeRecoveryEnabled==true and
    (.settings.backupConfiguration.transactionLogRetentionDays // 0)>=7 and
    (.settings.backupConfiguration.backupRetentionSettings.retainedBackups // 0)>=7
  ' /tmp/source.json >/dev/null
}

source_preflight_dr() {
  drgc sql instances describe "$SOURCE_INSTANCE" --project="$PROJECT_ID" --format=json > /tmp/source.json
  jq -e --arg project "$PROJECT_ID" --arg region "$REGION" '
    .project==$project and .region==$region and .name=="toca-mcp-next-staging-db" and
    .state=="RUNNABLE" and .databaseVersion=="POSTGRES_18" and
    .settings.backupConfiguration.enabled==true and
    .settings.backupConfiguration.pointInTimeRecoveryEnabled==true and
    (.settings.backupConfiguration.transactionLogRetentionDays // 0)>=7 and
    (.settings.backupConfiguration.backupRetentionSettings.retainedBackups // 0)>=7
  ' /tmp/source.json >/dev/null
}

case "$MODE" in
  bootstrap)
    assert_boundary
    [[ "$(gc projects describe "$PROJECT_ID" --format='value(projectNumber)')" == "$PROJECT_NUMBER" ]]
    source_preflight_direct
    echo 'DR_LP_V3_SOURCE_PREFLIGHT=PASS'

    MEMBER_INFRA="serviceAccount:${INFRA_ADMIN_SA}"
    POLICY_BEFORE="$(gc projects get-iam-policy "$PROJECT_ID" --format=json)"
    if jq -e --arg m "$MEMBER_INFRA" 'any(.bindings[]?; .role=="roles/iam.roleAdmin" and any(.members[]?; .==$m))' <<<"$POLICY_BEFORE" >/dev/null; then
      echo 'roles/iam.roleAdmin unexpectedly pre-existed for infra admin' >&2
      exit 1
    fi
    gc projects add-iam-policy-binding "$PROJECT_ID" --member="$MEMBER_INFRA" --role='roles/iam.roleAdmin' --condition=None --quiet >/dev/null
    echo 'roleadmin_granted=true' >> "${GITHUB_OUTPUT:?}"

    ! gc iam service-accounts describe "$DR_SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1
    gc iam service-accounts create "$DR_SA_ID" --project="$PROJECT_ID" --display-name='TOCA Next temporary isolated DR' --description="Temporary DR identity for run ${GITHUB_RUN_ID}" >/dev/null

    PERMISSIONS='cloudsql.instances.clone,cloudsql.instances.connect,cloudsql.instances.delete,cloudsql.instances.get,cloudsql.instances.update,cloudsql.operations.get,cloudsql.users.list,cloudsql.users.update,resourcemanager.projects.get,serviceusage.services.use'
    gc iam roles create "$DR_ROLE_ID" \
      --project="$PROJECT_ID" \
      --title='TOCA Next isolated DR least privilege' \
      --description="Temporary DR-only role for run ${GITHUB_RUN_ID}" \
      --permissions="$PERMISSIONS" \
      --stage=GA --quiet >/dev/null
    gc iam roles describe "$DR_ROLE_ID" --project="$PROJECT_ID" --format=json > /tmp/role.json
    [[ "$(jq -r '.includedPermissions[]' /tmp/role.json | sort)" == "$(tr ',' '\n' <<<"$PERMISSIONS" | sort)" ]]

    gc iam service-accounts add-iam-policy-binding "$DR_SA_EMAIL" \
      --project="$PROJECT_ID" \
      --member="$MEMBER_INFRA" \
      --role='roles/iam.serviceAccountTokenCreator' \
      --condition=None --quiet >/dev/null
    gc iam service-accounts get-iam-policy "$DR_SA_EMAIL" --project="$PROJECT_ID" --format=json > /tmp/dr-sa-policy.json
    jq -e --arg m "$MEMBER_INFRA" 'any(.bindings[]?; .role=="roles/iam.serviceAccountTokenCreator" and any(.members[]?; .==$m))' /tmp/dr-sa-policy.json >/dev/null

    ROLE="projects/${PROJECT_ID}/roles/${DR_ROLE_ID}"
    MEMBER_DR="serviceAccount:${DR_SA_EMAIL}"
    gc projects add-iam-policy-binding "$PROJECT_ID" --member="$MEMBER_DR" --role="$ROLE" --condition=None --quiet >/dev/null
    POLICY="$(gc projects get-iam-policy "$PROJECT_ID" --format=json)"
    jq -e --arg r "$ROLE" --arg m "$MEMBER_DR" 'any(.bindings[]?; .role==$r and any(.members[]?; .==$m))' <<<"$POLICY" >/dev/null
    for forbidden in roles/owner roles/editor roles/cloudsql.admin roles/run.admin roles/secretmanager.admin; do
      ! jq -e --arg r "$forbidden" --arg m "$MEMBER_DR" 'any(.bindings[]?; .role==$r and any(.members[]?; .==$m))' <<<"$POLICY" >/dev/null
    done

    sleep 20
    [[ "$(drgc projects describe "$PROJECT_ID" --format='value(projectNumber)')" == "$PROJECT_NUMBER" ]]
    source_preflight_dr
    echo 'DR_LP_V3_IMPERSONATION=PASS'
    echo 'DR_LP_V3_BOOTSTRAP=PASS'
    ;;

  drill)
    assert_boundary
    [[ "$(gc auth list --filter=status:ACTIVE --format='value(account)' | head -n1)" == "$INFRA_ADMIN_SA" ]]
    [[ "$(drgc projects describe "$PROJECT_ID" --format='value(projectNumber)')" == "$PROJECT_NUMBER" ]]
    [[ -d "$CANDIDATE_DIR/.git" ]]
    [[ "$(git -C "$CANDIDATE_DIR" rev-parse HEAD)" == "$CANDIDATE_SHA" ]]
    find "$CANDIDATE_DIR/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort > /tmp/repo-migrations.txt
    grep -Fxq '033_omnichannel_prepared_content.sql' /tmp/repo-migrations.txt
    ! grep -Eq '^027_' /tmp/repo-migrations.txt
    [[ "$(tail -n1 /tmp/repo-migrations.txt)" == '033_omnichannel_prepared_content.sql' ]]

    mkdir -p dr-v3-evidence
    source_preflight_dr
    jq '{project,name,region,state,databaseVersion,backupEnabled:.settings.backupConfiguration.enabled,pitrEnabled:.settings.backupConfiguration.pointInTimeRecoveryEnabled,transactionLogRetentionDays:.settings.backupConfiguration.transactionLogRetentionDays,retainedBackups:.settings.backupConfiguration.backupRetentionSettings.retainedBackups}' /tmp/source.json > dr-v3-evidence/source-before.json

    TOKEN="$(drgc auth print-access-token)"
    curl --fail --silent --show-error -H "Authorization: Bearer ${TOKEN}" "https://sqladmin.googleapis.com/v1/projects/${PROJECT_ID}/instances/${SOURCE_INSTANCE}/getLatestRecoveryTime" > /tmp/recovery.json
    unset TOKEN
    EARLIEST="$(jq -r '.earliestRecoveryTime' /tmp/recovery.json)"
    LATEST="$(jq -r '.latestRecoveryTime' /tmp/recovery.json)"
    [[ -n "$EARLIEST" && "$EARLIEST" != null && -n "$LATEST" && "$LATEST" != null ]]
    REFERENCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    REF_EPOCH="$(date -u -d "$REFERENCE" +%s)"
    LATEST_EPOCH="$(date -u -d "$LATEST" +%s)"
    EARLIEST_EPOCH="$(date -u -d "$EARLIEST" +%s)"
    PROVIDER_LAG="$((REF_EPOCH-LATEST_EPOCH))"
    SELECTED_EPOCH="$((LATEST_EPOCH-30))"
    (( SELECTED_EPOCH >= EARLIEST_EPOCH ))
    RPO_SECONDS="$((REF_EPOCH-SELECTED_EPOCH))"
    (( PROVIDER_LAG >= 0 && PROVIDER_LAG <= 900 ))
    (( RPO_SECONDS >= 0 && RPO_SECONDS <= 900 ))
    RECOVERY_POINT="$(date -u -d "@${SELECTED_EPOCH}" +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s\n' "$REFERENCE" > /tmp/reference
    printf '%s\n' "$RECOVERY_POINT" > /tmp/recovery-point
    printf '%s\n' "$PROVIDER_LAG" > /tmp/provider-lag
    printf '%s\n' "$RPO_SECONDS" > /tmp/rpo
    jq -n --arg earliest "$EARLIEST" --arg latest "$LATEST" --arg reference "$REFERENCE" --arg selected "$RECOVERY_POINT" --argjson lag "$PROVIDER_LAG" --argjson rpo "$RPO_SECONDS" '{earliestRecoveryTime:$earliest,latestRecoveryTime:$latest,referenceTime:$reference,selectedRecoveryPoint:$selected,providerLatestLagSeconds:$lag,rpoSeconds:$rpo,rpoObjectiveSeconds:900}' > dr-v3-evidence/recovery-window.json
    echo "DR_LP_V3_RECOVERY_WINDOW=PASS provider_lag_seconds=${PROVIDER_LAG} rpo_seconds=${RPO_SECONDS}"

    ! drgc sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1
    RESTORE_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s\n' "$RESTORE_STARTED" > /tmp/restore-started
    drgc sql instances clone "$SOURCE_INSTANCE" "$TARGET_INSTANCE" --project="$PROJECT_ID" --point-in-time="$RECOVERY_POINT" --quiet
    for attempt in $(seq 1 90); do
      STATE="$(drgc sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" --format='value(state)' 2>/dev/null || true)"
      if [[ "$STATE" == RUNNABLE ]]; then
        TARGET_RUNNABLE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf '%s\n' "$TARGET_RUNNABLE" > /tmp/target-runnable
        drgc sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" --format=json > /tmp/target.json
        jq -e --arg project "$PROJECT_ID" --arg region "$REGION" --arg target "$TARGET_INSTANCE" '.project==$project and .region==$region and .name==$target and .state=="RUNNABLE" and .databaseVersion=="POSTGRES_18"' /tmp/target.json >/dev/null
        jq '{project,name,region,state,databaseVersion,deletionProtectionEnabled:(.settings.deletionProtectionEnabled // false)}' /tmp/target.json > dr-v3-evidence/target-runnable.json
        break
      fi
      sleep 10
    done
    [[ -s /tmp/target-runnable ]]
    echo 'DR_LP_V3_TARGET_RUNNABLE=PASS'

    sudo apt-get update -qq
    sudo apt-get install -y -qq postgresql-client >/dev/null
    PASSWORD="$(openssl rand -hex 32)"
    echo "::add-mask::$PASSWORD"
    printf '%s' "$PASSWORD" > /tmp/dr-password
    chmod 600 /tmp/dr-password
    drgc sql users list --instance="$TARGET_INSTANCE" --project="$PROJECT_ID" --format=json > /tmp/users.json
    jq -e 'any(.[]?; .name=="postgres")' /tmp/users.json >/dev/null
    drgc sql users set-password postgres --instance="$TARGET_INSTANCE" --project="$PROJECT_ID" --password="$PASSWORD" --quiet >/dev/null

    PROXY_VERSION='2.24.1'
    PROXY_SHA256='fae2766aac9d614a2bdef2f2a7778f3d054f3acd5ff07a81a9e300bd471512eb'
    curl --fail --silent --show-error --location "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v${PROXY_VERSION}/cloud-sql-proxy.linux.amd64" --output /tmp/cloud-sql-proxy
    echo "${PROXY_SHA256}  /tmp/cloud-sql-proxy" | sha256sum --check --strict
    chmod 0755 /tmp/cloud-sql-proxy
    CONNECTION_NAME="$(drgc sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" --format='value(connectionName)')"
    [[ -n "$CONNECTION_NAME" ]]
    /tmp/cloud-sql-proxy --impersonate-service-account="$DR_SA_EMAIL" --address 127.0.0.1 --port 5432 "$CONNECTION_NAME" >/tmp/proxy.log 2>&1 &
    PROXY_PID=$!
    for attempt in $(seq 1 30); do
      if (echo >/dev/tcp/127.0.0.1/5432) >/dev/null 2>&1; then break; fi
      kill -0 "$PROXY_PID" 2>/dev/null || { cat /tmp/proxy.log >&2; exit 1; }
      sleep 1
    done
    (echo >/dev/tcp/127.0.0.1/5432) >/dev/null 2>&1

    export PGPASSWORD="$(cat /tmp/dr-password)"
    mapfile -t DBS < <(psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -Atqc "select datname from pg_database where datistemplate=false and datallowconn=true and datname <> 'postgres' order by datname")
    (( ${#DBS[@]} > 0 ))
    APP_DB=''
    for db in "${DBS[@]}"; do
      HAS="$(psql -h 127.0.0.1 -p 5432 -U postgres -d "$db" -Atqc "select to_regclass('public.schema_migrations') is not null" 2>/dev/null || true)"
      if [[ "$HAS" == t ]] && psql -h 127.0.0.1 -p 5432 -U postgres -d "$db" -Atqc "select 1 from schema_migrations where version='033_omnichannel_prepared_content.sql'" 2>/dev/null | grep -Fxq 1; then
        [[ -z "$APP_DB" ]] || { echo 'Multiple app DBs contain migration 033' >&2; exit 1; }
        APP_DB="$db"
      fi
    done
    [[ -n "$APP_DB" ]]
    psql -h 127.0.0.1 -p 5432 -U postgres -d "$APP_DB" -Atqc 'select version from schema_migrations order by version' > dr-v3-evidence/restored-migrations.txt
    diff -u /tmp/repo-migrations.txt dr-v3-evidence/restored-migrations.txt
    ! grep -Eq '^027_' dr-v3-evidence/restored-migrations.txt
    [[ "$(tail -n1 dr-v3-evidence/restored-migrations.txt)" == '033_omnichannel_prepared_content.sql' ]]

    REQUIRED_TABLES=(schema_migrations tenants approval_records workflow_instances workflow_steps workflow_timers workflow_events workflow_human_tasks workflow_compensations event_outbox event_outbox_delivery_attempts event_consumer_receipts dead_letter_jobs audit_ledger_events audit_ledger_heads operational_signals privacy_ledger_events crm_conversations crm_messages event_records ag01_conversations ag01_message_records ag01_runtime_circuits email_dispatches email_provider_events whatsapp_dispatches whatsapp_provider_events omnichannel_prepared_content)
    : > dr-v3-evidence/critical-table-counts.txt
    for table in "${REQUIRED_TABLES[@]}"; do
      [[ "$(psql -h 127.0.0.1 -p 5432 -U postgres -d "$APP_DB" -Atqc "select to_regclass('public.${table}') is not null")" == t ]]
      COUNT="$(psql -h 127.0.0.1 -p 5432 -U postgres -d "$APP_DB" -Atqc "select count(*) from public.${table}")"
      printf '%s=%s\n' "$table" "$COUNT" >> dr-v3-evidence/critical-table-counts.txt
    done
    [[ "$(psql -h 127.0.0.1 -p 5432 -U postgres -d "$APP_DB" -Atqc "select count(*) from pg_constraint where contype='f' and not convalidated")" == 0 ]]
    for trigger in audit_ledger_events_append_only operational_signals_append_only privacy_ledger_no_update privacy_ledger_no_delete ag01_message_records_append_only whatsapp_provider_events_append_only; do
      [[ "$(psql -h 127.0.0.1 -p 5432 -U postgres -d "$APP_DB" -Atqc "select count(*) from pg_trigger where tgname='${trigger}' and tgenabled <> 'D'")" == 1 ]]
    done
    [[ "$(psql -h 127.0.0.1 -p 5432 -U postgres -d "$APP_DB" -Atqc "select count(*) from information_schema.columns where table_schema='public' and table_name='omnichannel_prepared_content' and column_name in ('prepared_content_ref','tenant_id','workspace_id','organization_id','content_kind','schema_version','payload','content_sha256','evidence','created_at')")" == 10 ]]
    [[ "$(psql -h 127.0.0.1 -p 5432 -U postgres -d "$APP_DB" -Atqc "select count(*) from pg_indexes where schemaname='public' and indexname='omnichannel_prepared_content_scope_created_idx'")" == 1 ]]
    AUDIT_MISMATCH="$(psql -h 127.0.0.1 -p 5432 -U postgres -d "$APP_DB" -Atqc "select count(*) from audit_ledger_heads h left join lateral (select sequence,event_hash,correlation_id from audit_ledger_events e where e.execution_id=h.execution_id order by sequence desc limit 1) e on true where e.event_hash is null or h.last_sequence<>e.sequence or h.head_hash<>e.event_hash or h.correlation_id<>e.correlation_id")"
    [[ "$AUDIT_MISMATCH" == 0 ]]

    VALIDATION_COMPLETED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    RESTORE_STARTED="$(cat /tmp/restore-started)"
    TARGET_RUNNABLE="$(cat /tmp/target-runnable)"
    RTO_SECONDS="$(( $(date -u -d "$VALIDATION_COMPLETED" +%s) - $(date -u -d "$RESTORE_STARTED" +%s) ))"
    RUNNABLE_SECONDS="$(( $(date -u -d "$TARGET_RUNNABLE" +%s) - $(date -u -d "$RESTORE_STARTED" +%s) ))"
    RPO_SECONDS="$(cat /tmp/rpo)"
    (( RTO_SECONDS >= 0 && RTO_SECONDS <= 3600 ))
    (( RUNNABLE_SECONDS >= 0 && RUNNABLE_SECONDS <= 3600 ))
    (( RPO_SECONDS >= 0 && RPO_SECONDS <= 900 ))
    printf '%s\n' "$VALIDATION_COMPLETED" > /tmp/validation-completed
    printf '%s\n' "$RUNNABLE_SECONDS" > /tmp/runnable-seconds
    printf '%s\n' "$RTO_SECONDS" > /tmp/rto
    printf '%s\n' "$AUDIT_MISMATCH" > /tmp/audit-mismatch
    unset PGPASSWORD PASSWORD
    rm -f /tmp/dr-password
    echo "DR_LP_V3_DATABASE_VALIDATION=PASS migration_max=033 critical_tables=${#REQUIRED_TABLES[@]} audit_mismatch=${AUDIT_MISMATCH} rpo_seconds=${RPO_SECONDS} restore_to_runnable_seconds=${RUNNABLE_SECONDS} rto_seconds=${RTO_SECONDS}"
    ;;

  manifest)
    assert_boundary
    mkdir -p dr-v3-evidence
    read_or() { [[ -s "$1" ]] && cat "$1" || printf '%s' "$2"; }
    REFERENCE="$(read_or /tmp/reference '')"; RECOVERY="$(read_or /tmp/recovery-point '')"; RESTORE="$(read_or /tmp/restore-started '')"; RUNNABLE="$(read_or /tmp/target-runnable '')"; VALIDATED="$(read_or /tmp/validation-completed '')"
    LAG="$(read_or /tmp/provider-lag -1)"; RPO="$(read_or /tmp/rpo -1)"; RUN_SEC="$(read_or /tmp/runnable-seconds -1)"; RTO="$(read_or /tmp/rto -1)"; AUDIT="$(read_or /tmp/audit-mismatch -1)"
    jq -n --arg candidate "$CANDIDATE_SHA" --arg project "$PROJECT_ID" --arg source "$SOURCE_INSTANCE" --arg target "$TARGET_INSTANCE" --arg identity "$DR_SA_EMAIL" --arg reference "$REFERENCE" --arg recovery "$RECOVERY" --arg restore "$RESTORE" --arg runnable "$RUNNABLE" --arg validated "$VALIDATED" --argjson lag "$LAG" --argjson rpo "$RPO" --argjson runSec "$RUN_SEC" --argjson rto "$RTO" --argjson audit "$AUDIT" '{schemaVersion:4,operation:"authorized-isolated-staging-pitr-least-privilege-impersonated",candidateSha:$candidate,projectId:$project,sourceInstance:$source,targetInstance:$target,ephemeralDrIdentity:$identity,referenceTime:$reference,recoveryPoint:$recovery,restoreStartedAt:$restore,targetRunnableAt:$runnable,validationCompletedAt:$validated,providerLatestLagSeconds:$lag,rpoSeconds:$rpo,restoreToRunnableSeconds:$runSec,rtoSeconds:$rto,auditHeadMismatchCount:$audit,rpoObjectiveSeconds:900,rtoObjectiveSeconds:3600,migration033Required:true,gap027RequiredAbsent:true,productionMutation:false,providerMutation:false,trafficMutation:false,cloudRunMutation:false,secretManagerRead:false,secretManagerMutation:false}' > dr-v3-evidence/manifest.json
    find dr-v3-evidence -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > dr-v3-evidence/SHA256SUMS
    ;;

  cleanup-target)
    assert_boundary
    [[ "$(gc auth list --filter=status:ACTIVE --format='value(account)' | head -n1)" == "$INFRA_ADMIN_SA" ]]
    if drgc sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" --format=json >/tmp/target-cleanup.json 2>/dev/null; then
      jq -e --arg p "$PROJECT_ID" --arg t "$TARGET_INSTANCE" '.project==$p and .name==$t' /tmp/target-cleanup.json >/dev/null
      drgc sql instances patch "$TARGET_INSTANCE" --project="$PROJECT_ID" --no-deletion-protection --quiet
      drgc sql instances delete "$TARGET_INSTANCE" --project="$PROJECT_ID" --quiet
    fi
    ! drgc sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1
    source_preflight_dr
    echo 'DR_LP_V3_TARGET_CLEANUP=PASS source_unchanged=true'
    ;;

  cleanup-iam)
    assert_boundary
    [[ "$(gc projects describe "$PROJECT_ID" --format='value(projectNumber)')" == "$PROJECT_NUMBER" ]]
    ROLE="projects/${PROJECT_ID}/roles/${DR_ROLE_ID}"; MEMBER_DR="serviceAccount:${DR_SA_EMAIL}"; MEMBER_INFRA="serviceAccount:${INFRA_ADMIN_SA}"
    if gc sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" --format=json >/tmp/fallback.json 2>/dev/null; then
      jq -e --arg p "$PROJECT_ID" --arg t "$TARGET_INSTANCE" '.project==$p and .name==$t' /tmp/fallback.json >/dev/null
      gc sql instances patch "$TARGET_INSTANCE" --project="$PROJECT_ID" --no-deletion-protection --quiet
      gc sql instances delete "$TARGET_INSTANCE" --project="$PROJECT_ID" --quiet
    fi
    ! gc sql instances describe "$TARGET_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1
    POLICY="$(gc projects get-iam-policy "$PROJECT_ID" --format=json)"
    if jq -e --arg r "$ROLE" --arg m "$MEMBER_DR" 'any(.bindings[]?; .role==$r and any(.members[]?; .==$m))' <<<"$POLICY" >/dev/null; then
      gc projects remove-iam-policy-binding "$PROJECT_ID" --member="$MEMBER_DR" --role="$ROLE" --condition=None --quiet >/dev/null
    fi
    if gc iam service-accounts describe "$DR_SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then gc iam service-accounts delete "$DR_SA_EMAIL" --project="$PROJECT_ID" --quiet; fi
    if gc iam roles describe "$DR_ROLE_ID" --project="$PROJECT_ID" >/dev/null 2>&1; then gc iam roles delete "$DR_ROLE_ID" --project="$PROJECT_ID" --quiet >/dev/null; fi
    if [[ "${ROLEADMIN_GRANTED:-false}" == true ]]; then
      POLICY="$(gc projects get-iam-policy "$PROJECT_ID" --format=json)"
      if jq -e --arg m "$MEMBER_INFRA" 'any(.bindings[]?; .role=="roles/iam.roleAdmin" and any(.members[]?; .==$m))' <<<"$POLICY" >/dev/null; then gc projects remove-iam-policy-binding "$PROJECT_ID" --member="$MEMBER_INFRA" --role='roles/iam.roleAdmin' --condition=None --quiet >/dev/null; fi
    fi
    POLICY_AFTER="$(gc projects get-iam-policy "$PROJECT_ID" --format=json)"
    ! jq -e --arg m "$MEMBER_INFRA" 'any(.bindings[]?; .role=="roles/iam.roleAdmin" and any(.members[]?; .==$m))' <<<"$POLICY_AFTER" >/dev/null
    ! gc iam service-accounts describe "$DR_SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1
    source_preflight_direct
    echo 'DR_LP_V3_IAM_CLEANUP=PASS target_absent=true source_unchanged=true'
    ;;

  *) echo "Usage: $0 {bootstrap|drill|manifest|cleanup-target|cleanup-iam} [candidate-dir]" >&2; exit 2 ;;
esac
