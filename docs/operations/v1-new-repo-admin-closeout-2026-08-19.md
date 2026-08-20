# TOCA OS V1 — New-repository administrative closeout — 2026-08-19

Status: **BLOCKED ON TWO HOSTED ADMIN CONTROLS — NO APPLICATION GAP**

## Scope

This runbook closes hosted controls that could not migrate automatically with Git history from `luizidebook/toca-mcp-server` to `luizanunciostoca/toca-mcp-server`.

Do not use this document to change application capabilities, enable campaign activation, publish Instagram content, or widen provider permissions.

## 1. Google Cloud Workload Identity Federation repository trust

### Observed failure

Final V1 readback run `32317579469` reached `google-github-actions/auth` from the new repository and failed before `gcloud` with:

`unauthorized_client: The given credential is rejected by the attribute condition.`

No Google Cloud resource mutation occurred.

Provider:

`projects/990081828836/locations/global/workloadIdentityPools/github/providers/github-toca-mcp`

Target repository identity:

`luizanunciostoca/toca-mcp-server`

### Fail-closed inspection

Run in an authenticated Google Cloud Shell with authority to update the Workload Identity Pool provider:

```bash
set -euo pipefail
PROJECT_ID='toca-mcp-production'
POOL_ID='github'
PROVIDER_ID='github-toca-mcp'
OLD_REPO='luizidebook/toca-mcp-server'
NEW_REPO='luizanunciostoca/toca-mcp-server'

CURRENT_CONDITION="$(gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location='global' \
  --workload-identity-pool="$POOL_ID" \
  --format='value(attributeCondition)')"

printf 'CURRENT_ATTRIBUTE_CONDITION=%s\n' "$CURRENT_CONDITION"

test -n "$CURRENT_CONDITION"
case "$CURRENT_CONDITION" in
  *"$OLD_REPO"*) ;;
  *)
    echo 'STOP: the current condition does not contain the exact old repository identity. Do not guess or broaden the condition.' >&2
    exit 41
    ;;
esac

NEW_CONDITION="${CURRENT_CONDITION//$OLD_REPO/$NEW_REPO}"
printf 'PROPOSED_ATTRIBUTE_CONDITION=%s\n' "$NEW_CONDITION"
test "$NEW_CONDITION" != "$CURRENT_CONDITION"
```

### Minimal update

Only if the inspection above finds the exact old repository identity, apply the one-string substitution while preserving every other clause:

```bash
gcloud iam workload-identity-pools providers update-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location='global' \
  --workload-identity-pool="$POOL_ID" \
  --attribute-condition="$NEW_CONDITION"

AFTER_CONDITION="$(gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location='global' \
  --workload-identity-pool="$POOL_ID" \
  --format='value(attributeCondition)')"

printf 'AFTER_ATTRIBUTE_CONDITION=%s\n' "$AFTER_CONDITION"
test "$AFTER_CONDITION" = "$NEW_CONDITION"
```

Do not replace the condition with `true`, do not broaden it to an entire GitHub organization unless separately reviewed, and do not modify attribute mappings during this closeout.

### Required readback after update

Rerun PR #13 final V1 production readback. The gate must authenticate successfully and then verify exact Cloud Run identity, runtime safety flags, Cloud Scheduler state, and current Cloud SQL DR state before V1 promotion.

## 2. GitHub `main` hosted protection

Current API readback after Foundation restart-safety merge:

- `main` SHA: `abfb09b17e90c83790e803dcda091c8142c7407f`;
- `protected=false`;
- required status checks: none.

Before the final V1 closeout, configure hosted protection/rules for `main` with at least:

1. require a pull request before merging;
2. require the repository Quality Gate status check;
3. require applicable PostgreSQL E2E when it is emitted for a change;
4. block force pushes;
5. block branch deletion;
6. apply/enforce the rule to repository administrators where supported;
7. do not bypass required gates for routine releases.

After configuration, perform API readback and record the exact hosted state in the final V1 closeout evidence.

## 3. Final closeout sequence

After both hosted controls are corrected:

1. rerun PR #13 production/DR readback;
2. if the recovered release is not yet the active Cloud Run image, execute one canonical production deploy from the new repository after WIF succeeds;
3. repeat exact production readback;
4. record sanitized Cloud Run, Scheduler and Cloud SQL evidence;
5. remove the temporary readback workflow;
6. update canonical V1 state to the new repository identity and current evidence;
7. run exact-head Quality Gate;
8. merge the documentation-only closeout PR;
9. read back `main` protection and final repository SHA;
10. declare V1 complete only if all gates are green.
