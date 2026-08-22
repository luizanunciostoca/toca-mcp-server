#!/usr/bin/env bash
set -euo pipefail

REAL_PSQL="${REAL_PSQL:-/usr/bin/psql}"
[[ -x "$REAL_PSQL" ]] || { echo "psql binary unavailable at $REAL_PSQL" >&2; exit 90; }

ORIGINAL_ARGS=("$@")
ARGS=("$@")

# Preserve the V11/V12 discovery corrections: include postgres as an
# application-DB candidate, exclude Cloud SQL's internal database, and select
# a candidate DB by schema_migrations existence before requiring SELECT access.
for i in "${!ARGS[@]}"; do
  if [[ "${ARGS[$i]}" == *"select datname from pg_database where datistemplate=false and datallowconn=true and datname <> 'postgres' order by datname"* ]]; then
    ARGS[$i]="select datname from pg_database where datistemplate=false and datallowconn=true and datname <> 'cloudsqladmin' order by datname"
    echo 'DR_LP_V13_DB_DISCOVERY_INCLUDE_POSTGRES_EXCLUDE_CLOUDSQLADMIN=PASS' >&2
  elif [[ "${ARGS[$i]}" == *"select 1 from schema_migrations where version='033_omnichannel_prepared_content.sql'"* ]]; then
    ARGS[$i]="select 1 where to_regclass('public.schema_migrations') is not null"
    echo 'DR_LP_V13_APP_DB_SELECTION_BY_SCHEMA_MIGRATIONS=PASS' >&2
  fi
done

extract_arg() {
  local short="$1" long="$2" default_value="$3"
  local i
  for ((i=0; i<${#ORIGINAL_ARGS[@]}; i++)); do
    case "${ORIGINAL_ARGS[$i]}" in
      "$short"|"$long") printf '%s' "${ORIGINAL_ARGS[$((i+1))]:-$default_value}"; return 0 ;;
      "$long"=*) printf '%s' "${ORIGINAL_ARGS[$i]#*=}"; return 0 ;;
    esac
  done
  printf '%s' "$default_value"
}

DB_NAME="$(extract_arg -d --dbname '')"
OWNER_FILE=/tmp/dr-v13-app-owner
OWNER_DB_FILE=/tmp/dr-v13-app-db
OWNER_PASSWORD_FILE=/tmp/dr-v13-app-owner-password

# The Cloud SQL postgres account is intentionally not assumed to own application
# tables. On the isolated clone only, discover the owner of public.schema_migrations
# from PostgreSQL catalogs, rotate only that cloned login's password, then use the
# owner for exact restored-data validation. No GRANT/ALTER TABLE is performed and
# the source instance is never modified.
needs_owner_bootstrap=false
for arg in "${ORIGINAL_ARGS[@]}"; do
  if [[ "$arg" == *"select version from schema_migrations order by version"* ]]; then
    needs_owner_bootstrap=true
    break
  fi
done

if [[ "$needs_owner_bootstrap" == true && ! -s "$OWNER_FILE" ]]; then
  : "${PROJECT_ID:?PROJECT_ID required}"
  : "${TARGET_INSTANCE:?TARGET_INSTANCE required}"
  : "${DR_SA_EMAIL:?DR_SA_EMAIL required}"
  [[ -n "$DB_NAME" ]]

  APP_OWNER="$(PGCONNECT_TIMEOUT=5 "$REAL_PSQL" -h 127.0.0.1 -p 5432 -U postgres -d "$DB_NAME" -Atqc \
    "select pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='schema_migrations' and c.relkind in ('r','p') limit 1")"
  [[ -n "$APP_OWNER" ]]
  [[ "$APP_OWNER" != 'cloudsqladmin' ]]

  gcloud --impersonate-service-account="$DR_SA_EMAIL" sql users list \
    --instance="$TARGET_INSTANCE" --project="$PROJECT_ID" --format=json > /tmp/dr-v13-users.json
  jq -e --arg owner "$APP_OWNER" 'any(.[]?; .name==$owner)' /tmp/dr-v13-users.json >/dev/null

  APP_PASSWORD="$(openssl rand -hex 32)"
  # Workflow command must never share stdout with psql query results because the
  # caller may redirect stdout into evidence files. stderr remains the runner log
  # channel and keeps the generated clone-only password out of query output.
  printf '::add-mask::%s\n' "$APP_PASSWORD" >&2
  gcloud --impersonate-service-account="$DR_SA_EMAIL" sql users set-password "$APP_OWNER" \
    --instance="$TARGET_INSTANCE" --project="$PROJECT_ID" --password="$APP_PASSWORD" --quiet >/dev/null

  printf '%s' "$APP_OWNER" > "$OWNER_FILE"
  printf '%s' "$DB_NAME" > "$OWNER_DB_FILE"
  printf '%s' "$APP_PASSWORD" > "$OWNER_PASSWORD_FILE"
  chmod 600 "$OWNER_FILE" "$OWNER_DB_FILE" "$OWNER_PASSWORD_FILE"
  unset APP_PASSWORD
  echo 'DR_LP_V13_APP_TABLE_OWNER_AUTH=PASS clone_only=true grants_changed=false stdout_clean=true' >&2
fi

RUN_PASSWORD="${PGPASSWORD:-}"
if [[ -s "$OWNER_FILE" && -s "$OWNER_DB_FILE" && -s "$OWNER_PASSWORD_FILE" && "$DB_NAME" == "$(cat "$OWNER_DB_FILE")" ]]; then
  APP_OWNER="$(cat "$OWNER_FILE")"
  RUN_PASSWORD="$(cat "$OWNER_PASSWORD_FILE")"
  for i in "${!ARGS[@]}"; do
    if [[ "${ARGS[$i]}" == '-U' || "${ARGS[$i]}" == '--username' ]]; then
      ARGS[$((i+1))]="$APP_OWNER"
    elif [[ "${ARGS[$i]}" == --username=* ]]; then
      ARGS[$i]="--username=$APP_OWNER"
    fi
  done
fi

OUT="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$OUT" "$ERR"' EXIT

for attempt in $(seq 1 90); do
  : >"$OUT"
  : >"$ERR"
  set +e
  PGPASSWORD="$RUN_PASSWORD" PGCONNECT_TIMEOUT="${PGCONNECTTIMEOUT:-5}" "$REAL_PSQL" "${ARGS[@]}" >"$OUT" 2>"$ERR"
  rc=$?
  set -e

  if [[ "$rc" -eq 0 ]]; then
    if [[ "$attempt" -gt 1 ]]; then
      echo "DR_LP_V13_PSQL_TRANSIENT_RECOVERY=PASS attempt=${attempt}" >&2
    fi
    cat "$OUT"
    exit 0
  fi

  if grep -Eqi 'password authentication failed|connection to server .* failed|could not connect to server|connection refused|server closed the connection unexpectedly|database system is starting up|timeout expired|SSL connection has been closed unexpectedly|connection reset by peer|failed to connect' "$ERR"; then
    sleep 5
    continue
  fi

  cat "$ERR" >&2
  exit "$rc"
done

echo 'PostgreSQL connection/authentication did not converge within bounded retry window' >&2
cat "$ERR" >&2
if [[ -f /tmp/proxy.log ]]; then
  echo 'DR_LP_V13_PROXY_DIAGNOSTIC_BEGIN' >&2
  grep -Eai 'error|failed|403|timeout|refused|closed|refresh|connect' /tmp/proxy.log \
    | tail -n 20 \
    | sed -E 's/(authorization|bearer|token|password)([=: ]+)[^ ]+/\1\2[REDACTED]/Ig' >&2 || true
  echo 'DR_LP_V13_PROXY_DIAGNOSTIC_END' >&2
fi
exit 91
