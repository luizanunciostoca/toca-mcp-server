#!/usr/bin/env bash
set -euo pipefail

# Digest resolution needs the registry manifest, not Container Analysis
# occurrences. Reuse the caller's existing Docker/WIF authentication.
test "$#" -eq 1 || { echo 'REGISTRY_IMAGE_REFERENCE_REQUIRED' >&2; exit 1; }
IMAGE_REF="$1"
PREFIX='southamerica-east1-docker.pkg.dev/toca-mcp-production/toca-mcp/'
if [[ "$IMAGE_REF" != "$PREFIX"* ]] || [[ ! "${IMAGE_REF#"$PREFIX"}" =~ ^(ag01|server|duplicate-preflight)(:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})$ ]]; then
  echo 'REGISTRY_IMAGE_REFERENCE_OUT_OF_SCOPE' >&2
  exit 1
fi

read_digest() {
  local manifest digest
  if ! manifest="$(timeout --kill-after=5s 30s docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' 2>/dev/null)"; then
    echo 'REGISTRY_MANIFEST_READ_FAILED' >&2
    return 1
  fi
  if ! digest="$(jq -ers '
    if length == 1 then .[0] else error("single descriptor required") end |
    select(.schemaVersion == 2) |
    select(.mediaType | IN(
      "application/vnd.docker.distribution.manifest.v2+json",
      "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.oci.image.index.v1+json"
    )) |
    .digest | select(type == "string" and length == 71 and test("^sha256:[a-f0-9]{64}$"))
  ' <<< "$manifest" 2>/dev/null)"; then
    echo 'REGISTRY_MANIFEST_DIGEST_INVALID' >&2
    return 1
  fi
  if [[ ! "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo 'REGISTRY_MANIFEST_DIGEST_INVALID' >&2
    return 1
  fi
  printf '%s\n' "$digest"
}

DIGEST="$(read_digest "$IMAGE_REF")"
if [[ "$IMAGE_REF" == *@* ]]; then
  EXPECTED_DIGEST="${IMAGE_REF##*@}"
else
  EXPECTED_DIGEST="$(read_digest "${IMAGE_REF%:*}@$DIGEST")"
fi
if [[ "$DIGEST" != "$EXPECTED_DIGEST" ]]; then
  echo 'REGISTRY_IMMUTABLE_DIGEST_MISMATCH' >&2
  exit 1
fi
printf '%s\n' "$DIGEST"
