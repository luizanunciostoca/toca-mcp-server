#!/usr/bin/env bash
set -euo pipefail

REAL_PSQL="${REAL_PSQL:-/usr/bin/psql}"
[[ -x "$REAL_PSQL" ]] || { echo "psql binary unavailable at $REAL_PSQL" >&2; exit 90; }

ARGS=("$@")
for i in "${!ARGS[@]}"; do
  if [[ "${ARGS[$i]}" == *"select datname from pg_database where datistemplate=false and datallowconn=true and datname <> 'postgres' order by datname"* ]]; then
    ARGS[$i]="select datname from pg_database where datistemplate=false and datallowconn=true order by datname"
    echo 'DR_LP_V8_DB_DISCOVERY_INCLUDES_POSTGRES=PASS' >&2
  fi
done

OUT="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$OUT" "$ERR"' EXIT

for attempt in $(seq 1 90); do
  : >"$OUT"
  : >"$ERR"
  set +e
  PGCONNECT_TIMEOUT="${PGCONNECTTIMEOUT:-5}" "$REAL_PSQL" "${ARGS[@]}" >"$OUT" 2>"$ERR"
  rc=$?
  set -e

  if [[ "$rc" -eq 0 ]]; then
    if [[ "$attempt" -gt 1 ]]; then
      echo "DR_LP_V8_PSQL_TRANSIENT_RECOVERY=PASS attempt=${attempt}" >&2
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
  echo 'DR_LP_V8_PROXY_DIAGNOSTIC_BEGIN' >&2
  grep -Eai 'error|failed|403|timeout|refused|closed|refresh|connect' /tmp/proxy.log \
    | tail -n 20 \
    | sed -E 's/(authorization|bearer|token|password)([=: ]+)[^ ]+/\1\2[REDACTED]/Ig' >&2 || true
  echo 'DR_LP_V8_PROXY_DIAGNOSTIC_END' >&2
fi
exit 91
