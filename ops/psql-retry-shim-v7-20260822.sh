#!/usr/bin/env bash
set -euo pipefail

REAL_PSQL="${REAL_PSQL:-/usr/bin/psql}"
[[ -x "$REAL_PSQL" ]] || { echo "psql binary unavailable at $REAL_PSQL" >&2; exit 90; }

OUT="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$OUT" "$ERR"' EXIT

for attempt in $(seq 1 30); do
  : >"$OUT"
  : >"$ERR"
  set +e
  "$REAL_PSQL" "$@" >"$OUT" 2>"$ERR"
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    if [[ "$attempt" -gt 1 ]]; then
      echo "DR_LP_V7_PSQL_TRANSIENT_RECOVERY=PASS attempt=${attempt}" >&2
    fi
    cat "$OUT"
    exit 0
  fi

  if grep -Eqi 'password authentication failed|connection to server .* failed|could not connect to server|connection refused|server closed the connection unexpectedly|database system is starting up|timeout expired|SSL connection has been closed unexpectedly|connection reset by peer' "$ERR"; then
    sleep 5
    continue
  fi

  cat "$ERR" >&2
  exit "$rc"
done

echo 'PostgreSQL connection/authentication did not converge within bounded retry window' >&2
cat "$ERR" >&2
exit 91
