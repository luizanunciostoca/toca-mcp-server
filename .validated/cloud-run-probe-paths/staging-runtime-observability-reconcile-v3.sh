#!/usr/bin/env bash
set -euo pipefail

: "${POLICY_PATH:?POLICY_PATH is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"
: "${PROJECT_NUMBER:?PROJECT_NUMBER is required}"
: "${PRODUCTION_PROJECT_ID:?PRODUCTION_PROJECT_ID is required}"
: "${PRODUCTION_PROJECT_NUMBER:?PRODUCTION_PROJECT_NUMBER is required}"
: "${REGION:?REGION is required}"
: "${MCP_SERVICE:?MCP_SERVICE is required}"
: "${WEBHOOK_SERVICE:?WEBHOOK_SERVICE is required}"
: "${STAGING_OPERATOR_SA:?STAGING_OPERATOR_SA is required}"
: "${HOST:?HOST is required}"

EVIDENCE_DIR="${EVIDENCE_DIR:-staging-runtime-observability-evidence}"
mkdir -p "$EVIDENCE_DIR"

test "$PROJECT_ID" != "$PRODUCTION_PROJECT_ID"
test "$PROJECT_NUMBER" != "$PRODUCTION_PROJECT_NUMBER"
test "$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')" = "$PROJECT_NUMBER"
test "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n1)" = "$STAGING_OPERATOR_SA"

TOKEN="$(gcloud auth print-access-token)"
trap 'unset TOKEN' EXIT
AUTH_HEADER="Authorization: Bearer ${TOKEN}"
UPTIME_API="https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/uptimeCheckConfigs"
ALERT_API="https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/alertPolicies"
CHANNEL_API="https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/notificationChannels"
DASH_API="https://monitoring.googleapis.com/v1/projects/${PROJECT_ID}/dashboards"

api_get() {
  local url="$1" out="$2"
  curl --fail --silent --show-error -H "$AUTH_HEADER" "$url" > "$out"
}

api_post() {
  local url="$1" body="$2" out="$3"
  curl --fail --silent --show-error -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data-binary "@$body" "$url" > "$out"
}

api_patch() {
  local url="$1" body="$2" out="$3"
  curl --fail --silent --show-error -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data-binary "@$body" "$url" > "$out"
}

api_get "$CHANNEL_API?pageSize=100" /tmp/staging-notification-channels.json
MANAGED_LABEL="$(jq -r '.notificationChannels.managedLabel' "$POLICY_PATH")"
REQUIRED_COUNT="$(jq -r '.notificationChannels.requiredEnabledCount' "$POLICY_PATH")"
mapfile -t REQUIRED_FAMILIES < <(jq -r '.notificationChannels.requiredFamilies[]' "$POLICY_PATH")
mapfile -t CHANNEL_NAMES < <(jq -r --arg label "$MANAGED_LABEL" '.notificationChannels // [] | .[] | select(.enabled != false and .userLabels.toca_managed==$label) | .name' /tmp/staging-notification-channels.json)

test "${#CHANNEL_NAMES[@]}" -ge "$REQUIRED_COUNT"
for family in "${REQUIRED_FAMILIES[@]}"; do
  jq -e --arg label "$MANAGED_LABEL" --arg family "$family" 'any(.notificationChannels[]?; .enabled != false and .userLabels.toca_managed==$label and .type==$family)' /tmp/staging-notification-channels.json >/dev/null
done
CHANNELS_JSON="$(printf '%s\n' "${CHANNEL_NAMES[@]}" | jq -R . | jq -s 'sort')"
jq --arg label "$MANAGED_LABEL" --argjson required "$REQUIRED_COUNT" --argjson channels "$CHANNELS_JSON" '{managedLabel:$label,requiredEnabledCount:$required,channelNames:$channels}' > "$EVIDENCE_DIR/notification-channels.json"
echo 'STAGING_NOTIFICATION_CHANNELS=PASS'

api_get "$UPTIME_API?pageSize=100" /tmp/staging-uptimes.json

uptime_projection() {
  jq -S '{displayName,monitoredResource,httpCheck,contentMatchers:(.contentMatchers // []),timeout,period}' "$1"
}

ensure_uptime() {
  local display_name="$1" check_name="${2:-}" existing body result name desired actual
  existing="$(jq -r --arg display "$display_name" 'first(.uptimeCheckConfigs[]? | select(.displayName==$display) | .name) // empty' /tmp/staging-uptimes.json)"
  body="/tmp/uptime-${RANDOM}.json"
  result="/tmp/uptime-result-${RANDOM}.json"

  if [[ -z "$check_name" ]]; then
    jq -n --arg display "$display_name" --arg project "$PROJECT_ID" --arg location "$REGION" --arg service "$WEBHOOK_SERVICE" '{
      displayName:$display,
      monitoredResource:{type:"cloud_run_revision",labels:{project_id:$project,location:$location,service_name:$service}},
      httpCheck:{requestMethod:"GET",path:"/ready",port:443,useSsl:true,serviceAgentAuthentication:{type:"OIDC_TOKEN"}},
      timeout:"10s",
      period:"300s"
    }' > "$body"
  else
    local matcher
    matcher="\"name\":\"${check_name}\",\"ok\":true"
    jq -n --arg display "$display_name" --arg project "$PROJECT_ID" --arg location "$REGION" --arg service "$WEBHOOK_SERVICE" --arg matcher "$matcher" '{
      displayName:$display,
      monitoredResource:{type:"cloud_run_revision",labels:{project_id:$project,location:$location,service_name:$service}},
      httpCheck:{requestMethod:"GET",path:"/ready",port:443,useSsl:true,serviceAgentAuthentication:{type:"OIDC_TOKEN"},acceptedResponseStatusCodes:[{statusClass:"STATUS_CLASS_2XX"},{statusValue:503}]},
      contentMatchers:[{content:$matcher,matcher:"CONTAINS_STRING"}],
      timeout:"10s",
      period:"300s"
    }' > "$body"
  fi

  if [[ -z "$existing" ]]; then
    api_post "$UPTIME_API" "$body" "$result"
    name="$(jq -r '.name' "$result")"
  else
    name="$existing"
    api_get "https://monitoring.googleapis.com/v3/${name}" "$result"
    desired="$(uptime_projection "$body")"
    actual="$(uptime_projection "$result")"
    if [[ "$actual" != "$desired" ]]; then
      echo "UPTIME_CONFIG_DRIFT_REQUIRES_COORDINATION:${display_name}" >&2
      exit 1
    fi
  fi

  api_get "https://monitoring.googleapis.com/v3/${name}" "$result"
  jq -e --arg display "$display_name" --arg service "$WEBHOOK_SERVICE" '.displayName==$display and .monitoredResource.type=="cloud_run_revision" and .monitoredResource.labels.service_name==$service and .httpCheck.path=="/ready" and .httpCheck.useSsl==true and .httpCheck.serviceAgentAuthentication.type=="OIDC_TOKEN" and .period=="300s" and .timeout=="10s"' "$result" >/dev/null
  if [[ -n "$check_name" ]]; then
    jq -e --arg matcher "\"name\":\"${check_name}\",\"ok\":true" '.httpCheck.acceptedResponseStatusCodes == [{statusClass:"STATUS_CLASS_2XX"},{statusValue:503}] and .contentMatchers == [{content:$matcher,matcher:"CONTAINS_STRING"}]' "$result" >/dev/null
  fi
  printf '%s' "$name"
}

GLOBAL_DISPLAY="$(jq -r '.uptimeCheck.displayName' "$POLICY_PATH")"
GLOBAL_UPTIME="$(ensure_uptime "$GLOBAL_DISPLAY")"
GLOBAL_CHECK_ID="${GLOBAL_UPTIME##*/}"

: > /tmp/domain-uptimes.tsv
while IFS=$'\t' read -r id display check_name alert_role; do
  name="$(ensure_uptime "$display" "$check_name")"
  printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$display" "$check_name" "$alert_role" "$name" >> /tmp/domain-uptimes.tsv
done < <(jq -r '.domainReadiness[] | [.id,.displayName,.checkName,.alertRole] | @tsv' "$POLICY_PATH")
echo 'STAGING_DOMAIN_UPTIME_CONFIGS=PASS'

api_get "$ALERT_API?pageSize=100" /tmp/staging-alert-policies.json
ALERT_LABEL="$(jq -r '.alerting.managedLabel' "$POLICY_PATH")"
AUTO_CLOSE="$(jq -r '.alerting.autoClose' "$POLICY_PATH")"
UPTIME_DURATION="$(jq -r '.alerting.uptimeFailureDuration' "$POLICY_PATH")"
RUNBOOK="$(jq -r '.alerting.runbook' "$POLICY_PATH")"

alert_projection() {
  jq -S '{
    displayName,
    documentation,
    userLabels,
    conditions:[.conditions[] | del(.name)],
    combiner,
    enabled,
    notificationChannels:(.notificationChannels | sort),
    alertStrategy
  }' "$1"
}

ensure_alert_policy() {
  local role="$1" body="$2" out="$3" existing desired actual
  existing="$(jq -r --arg label "$ALERT_LABEL" --arg role "$role" 'first(.alertPolicies[]? | select(.userLabels.toca_managed==$label and .userLabels.alert_role==$role) | .name) // empty' /tmp/staging-alert-policies.json)"
  if [[ -z "$existing" ]]; then
    api_post "$ALERT_API" "$body" "$out"
  else
    api_get "https://monitoring.googleapis.com/v3/${existing}" "$out"
    desired="$(alert_projection "$body")"
    actual="$(alert_projection "$out")"
    if [[ "$actual" != "$desired" ]]; then
      echo "ALERT_POLICY_DRIFT_REQUIRES_COORDINATION:${role}" >&2
      exit 1
    fi
  fi
  jq -e --arg label "$ALERT_LABEL" --arg role "$role" '.enabled==true and .userLabels.toca_managed==$label and .userLabels.alert_role==$role and (.notificationChannels|length)>=2' "$out" >/dev/null
}

make_uptime_alert_body() {
  local display="$1" role="$2" check_id="$3" body="$4"
  jq -n --arg display "$display" --arg role "$role" --arg label "$ALERT_LABEL" --arg checkId "$check_id" --arg duration "$UPTIME_DURATION" --arg autoClose "$AUTO_CLOSE" --arg runbook "$RUNBOOK" --argjson channels "$CHANNELS_JSON" '{
    displayName:($display + " Alert"),
    documentation:{content:("Staging-only readiness incident. Runbook: " + $runbook),mimeType:"text/markdown"},
    userLabels:{toca_managed:$label,alert_role:$role,severity:"p1"},
    conditions:[{displayName:("Readiness failure: " + $display),conditionThreshold:{
      filter:("metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"" + $checkId + "\" AND resource.type=\"cloud_run_revision\""),
      aggregations:[{alignmentPeriod:"300s",perSeriesAligner:"ALIGN_NEXT_OLDER",crossSeriesReducer:"REDUCE_COUNT_FALSE",groupByFields:["resource.label.*"]}],
      comparison:"COMPARISON_GT",thresholdValue:0,duration:$duration,trigger:{count:1}
    }}],
    combiner:"OR",
    enabled:true,
    notificationChannels:$channels,
    alertStrategy:{autoClose:$autoClose}
  }' > "$body"
}

make_uptime_alert_body "$GLOBAL_DISPLAY" "availability" "$GLOBAL_CHECK_ID" /tmp/availability-alert.json
ensure_alert_policy "availability" /tmp/availability-alert.json /tmp/availability-alert-result.json

while IFS=$'\t' read -r id display check_name role name; do
  check_id="${name##*/}"
  body="/tmp/${id}-alert.json"
  out="/tmp/${id}-alert-result.json"
  make_uptime_alert_body "$display" "$role" "$check_id" "$body"
  ensure_alert_policy "$role" "$body" "$out"
done < /tmp/domain-uptimes.tsv
echo 'STAGING_DOMAIN_ALERT_POLICIES=PASS'

LATENCY_DISPLAY="$(jq -r '.nativeSignals.latency.displayName' "$POLICY_PATH")"
LATENCY_ROLE="$(jq -r '.nativeSignals.latency.alertRole' "$POLICY_PATH")"
LATENCY_METRIC="$(jq -r '.nativeSignals.latency.metricType' "$POLICY_PATH")"
LATENCY_ALIGNER="$(jq -r '.nativeSignals.latency.aligner' "$POLICY_PATH")"
LATENCY_ALIGNMENT="$(jq -r '.nativeSignals.latency.alignmentPeriod' "$POLICY_PATH")"
LATENCY_THRESHOLD="$(jq -r '.nativeSignals.latency.thresholdMilliseconds' "$POLICY_PATH")"
LATENCY_DURATION="$(jq -r '.nativeSignals.latency.duration' "$POLICY_PATH")"
NATIVE_SCOPE="resource.type=\"cloud_run_revision\" AND (resource.label.\"service_name\"=\"${MCP_SERVICE}\" OR resource.label.\"service_name\"=\"${WEBHOOK_SERVICE}\")"
jq -n --arg display "$LATENCY_DISPLAY" --arg role "$LATENCY_ROLE" --arg label "$ALERT_LABEL" --arg metric "$LATENCY_METRIC" --arg scope "$NATIVE_SCOPE" --arg aligner "$LATENCY_ALIGNER" --arg alignment "$LATENCY_ALIGNMENT" --argjson threshold "$LATENCY_THRESHOLD" --arg duration "$LATENCY_DURATION" --arg autoClose "$AUTO_CLOSE" --arg runbook "$RUNBOOK" --argjson channels "$CHANNELS_JSON" '{
  displayName:$display,
  documentation:{content:("Staging-only HTTP latency incident. Runbook: " + $runbook),mimeType:"text/markdown"},
  userLabels:{toca_managed:$label,alert_role:$role,severity:"p1"},
  conditions:[{displayName:$display,conditionThreshold:{filter:("metric.type=\""+$metric+"\" AND "+$scope),aggregations:[{alignmentPeriod:$alignment,perSeriesAligner:$aligner,crossSeriesReducer:"REDUCE_MAX",groupByFields:["resource.label.service_name"]}],comparison:"COMPARISON_GT",thresholdValue:$threshold,duration:$duration,trigger:{count:1}}}],
  combiner:"OR",enabled:true,notificationChannels:$channels,alertStrategy:{autoClose:$autoClose}
}' > /tmp/latency-alert.json
ensure_alert_policy "$LATENCY_ROLE" /tmp/latency-alert.json /tmp/latency-alert-result.json

ERROR_DISPLAY="$(jq -r '.nativeSignals.errorRate.displayName' "$POLICY_PATH")"
ERROR_ROLE="$(jq -r '.nativeSignals.errorRate.alertRole' "$POLICY_PATH")"
ERROR_METRIC="$(jq -r '.nativeSignals.errorRate.metricType' "$POLICY_PATH")"
ERROR_CLASS="$(jq -r '.nativeSignals.errorRate.errorResponseClass' "$POLICY_PATH")"
ERROR_ALIGNER="$(jq -r '.nativeSignals.errorRate.aligner' "$POLICY_PATH")"
ERROR_ALIGNMENT="$(jq -r '.nativeSignals.errorRate.alignmentPeriod' "$POLICY_PATH")"
ERROR_THRESHOLD="$(jq -r '.nativeSignals.errorRate.thresholdRatio' "$POLICY_PATH")"
ERROR_DURATION="$(jq -r '.nativeSignals.errorRate.duration' "$POLICY_PATH")"
NUMERATOR="metric.type=\"${ERROR_METRIC}\" AND metric.label.\"response_code_class\"=\"${ERROR_CLASS}\" AND ${NATIVE_SCOPE}"
DENOMINATOR="metric.type=\"${ERROR_METRIC}\" AND ${NATIVE_SCOPE}"
jq -n --arg display "$ERROR_DISPLAY" --arg role "$ERROR_ROLE" --arg label "$ALERT_LABEL" --arg numerator "$NUMERATOR" --arg denominator "$DENOMINATOR" --arg aligner "$ERROR_ALIGNER" --arg alignment "$ERROR_ALIGNMENT" --argjson threshold "$ERROR_THRESHOLD" --arg duration "$ERROR_DURATION" --arg autoClose "$AUTO_CLOSE" --arg runbook "$RUNBOOK" --argjson channels "$CHANNELS_JSON" '{
  displayName:$display,
  documentation:{content:("Staging-only HTTP 5xx ratio incident. Runbook: " + $runbook),mimeType:"text/markdown"},
  userLabels:{toca_managed:$label,alert_role:$role,severity:"p1"},
  conditions:[{displayName:$display,conditionThreshold:{filter:$numerator,aggregations:[{alignmentPeriod:$alignment,perSeriesAligner:$aligner,crossSeriesReducer:"REDUCE_SUM",groupByFields:["resource.label.service_name"]}],denominatorFilter:$denominator,denominatorAggregations:[{alignmentPeriod:$alignment,perSeriesAligner:$aligner,crossSeriesReducer:"REDUCE_SUM",groupByFields:["resource.label.service_name"]}],comparison:"COMPARISON_GT",thresholdValue:$threshold,duration:$duration,trigger:{count:1}}}],
  combiner:"OR",enabled:true,notificationChannels:$channels,alertStrategy:{autoClose:$autoClose}
}' > /tmp/error-rate-alert.json
ensure_alert_policy "$ERROR_ROLE" /tmp/error-rate-alert.json /tmp/error-rate-alert-result.json
echo 'STAGING_NATIVE_SLI_ALERT_POLICIES=PASS'

api_get "$ALERT_API?pageSize=100" /tmp/staging-alert-policies-after.json
EXPECTED_ROLES='["availability","db_readiness","ag01_readiness","workflow_readiness","approval_readiness","crm_readiness","outbox_dlq_readiness","http_latency","http_error_rate"]'
jq -e --arg label "$ALERT_LABEL" --argjson expected "$EXPECTED_ROLES" '([.alertPolicies[]? | select(.enabled==true and .userLabels.toca_managed==$label) | .userLabels.alert_role] | unique) as $actual | all($expected[]; . as $role | $actual | index($role) != null)' /tmp/staging-alert-policies-after.json >/dev/null

api_get "$DASH_API?pageSize=100" /tmp/staging-dashboards.json
DASH_DISPLAY="$(jq -r '.dashboard.displayName' "$POLICY_PATH")"
DASH_NAME="$(jq -r --arg display "$DASH_DISPLAY" 'first(.dashboards[]? | select(.displayName==$display) | .name) // empty' /tmp/staging-dashboards.json)"
mapfile -t INCIDENT_POLICIES < <(jq -r --arg label "$ALERT_LABEL" '.alertPolicies[]? | select(.enabled==true and .userLabels.toca_managed==$label) | .name | sub("^projects/[^/]+/";"")' /tmp/staging-alert-policies-after.json)
INCIDENT_POLICIES_JSON="$(printf '%s\n' "${INCIDENT_POLICIES[@]}" | jq -R . | jq -s 'sort')"
LATENCY_POLICY="$(jq -r --arg label "$ALERT_LABEL" --arg role "$LATENCY_ROLE" 'first(.alertPolicies[]? | select(.userLabels.toca_managed==$label and .userLabels.alert_role==$role) | .name) // empty' /tmp/staging-alert-policies-after.json)"
ERROR_POLICY="$(jq -r --arg label "$ALERT_LABEL" --arg role "$ERROR_ROLE" 'first(.alertPolicies[]? | select(.userLabels.toca_managed==$label and .userLabels.alert_role==$role) | .name) // empty' /tmp/staging-alert-policies-after.json)"
test -n "$LATENCY_POLICY"
test -n "$ERROR_POLICY"

jq -n --arg display "$DASH_DISPLAY" --arg latencyPolicy "$LATENCY_POLICY" --arg errorPolicy "$ERROR_POLICY" --argjson incidentPolicies "$INCIDENT_POLICIES_JSON" '{
  displayName:$display,
  labels:{staging_reliability:"",toca_os_next:"",full_sli_coverage:""},
  mosaicLayout:{columns:48,tiles:[
    {xPos:0,yPos:0,width:48,height:5,widget:{text:{content:"# TOCA OS Next — Staging Reliability\n\nAvailability, latency, error rate, DB, AG-01, Workflow, Approval, CRM, Outbox and DLQ are reconciled from canonical staging signals. Provider-gated signals remain inactive until provider verification.",format:"MARKDOWN"}}},
    {xPos:0,yPos:5,width:16,height:14,widget:{title:"Cloud Run request rate",xyChart:{dataSets:[{timeSeriesQuery:{timeSeriesFilter:{filter:"metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\"",aggregation:{alignmentPeriod:"60s",perSeriesAligner:"ALIGN_RATE"}}},plotType:"LINE",minAlignmentPeriod:"60s"}],yAxis:{scale:"LINEAR"},chartOptions:{mode:"COLOR"}}}},
    {xPos:16,yPos:5,width:16,height:14,widget:{title:"HTTP P95 latency alert",alertChart:{name:$latencyPolicy}}},
    {xPos:32,yPos:5,width:16,height:14,widget:{title:"HTTP 5xx error-rate alert",alertChart:{name:$errorPolicy}}},
    {xPos:0,yPos:19,width:48,height:12,widget:{title:"Staging reliability incidents",incidentList:{policyNames:$incidentPolicies,monitoredResources:[]}}}
  ]}
}' > /tmp/dashboard-desired.json

if [[ -z "$DASH_NAME" ]]; then
  api_post "$DASH_API" /tmp/dashboard-desired.json /tmp/dashboard-result.json
  DASH_NAME="$(jq -r '.name' /tmp/dashboard-result.json)"
else
  api_get "https://monitoring.googleapis.com/v1/${DASH_NAME}" /tmp/dashboard-current.json
  if ! jq -e '.displayName=="TOCA OS Next — Platform Readiness — Staging" and (.labels|has("full_sli_coverage")) and (.mosaicLayout.tiles|length)>=5' /tmp/dashboard-current.json >/dev/null; then
    ETAG="$(jq -r '.etag' /tmp/dashboard-current.json)"
    jq --arg name "$DASH_NAME" --arg etag "$ETAG" '. + {name:$name,etag:$etag}' /tmp/dashboard-desired.json > /tmp/dashboard-patch.json
    api_patch "https://monitoring.googleapis.com/v1/${DASH_NAME}" /tmp/dashboard-patch.json /tmp/dashboard-result.json
  fi
fi
api_get "https://monitoring.googleapis.com/v1/${DASH_NAME}" /tmp/dashboard-readback.json
jq -e '.displayName=="TOCA OS Next — Platform Readiness — Staging" and (.labels|has("full_sli_coverage")) and (.mosaicLayout.tiles|length)>=5' /tmp/dashboard-readback.json >/dev/null
echo 'STAGING_FULL_SLI_DASHBOARD=PASS'

mapfile -t CHECK_IDS < <(printf '%s\n' "$GLOBAL_CHECK_ID"; awk -F'\t' '{n=$5; sub(/^.*\//,"",n); print n}' /tmp/domain-uptimes.tsv)
OBSERVED=0
for attempt in $(seq 1 20); do
  START="$(date -u -d '20 minutes ago' +%Y-%m-%dT%H:%M:%SZ)"
  END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  all_pass=1
  : > /tmp/uptime-observations.tsv
  for check_id in "${CHECK_IDS[@]}"; do
    FILTER="metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id = \"${check_id}\" AND resource.type = \"cloud_run_revision\""
    curl --fail --silent --show-error --get -H "$AUTH_HEADER" --data-urlencode "filter=${FILTER}" --data-urlencode "interval.startTime=${START}" --data-urlencode "interval.endTime=${END}" --data-urlencode 'view=FULL' "https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/timeSeries" > /tmp/series.json
    true_points="$(jq '[.timeSeries[]?.points[]?.value.boolValue | select(.==true)] | length' /tmp/series.json)"
    false_points="$(jq '[.timeSeries[]?.points[]?.value.boolValue | select(.==false)] | length' /tmp/series.json)"
    printf '%s\t%s\t%s\n' "$check_id" "$true_points" "$false_points" >> /tmp/uptime-observations.tsv
    if [[ "$true_points" -lt 1 ]]; then all_pass=0; fi
  done
  if [[ "$all_pass" = 1 ]]; then OBSERVED=1; break; fi
  sleep 15
done
test "$OBSERVED" = 1

echo '{"checks":[' > "$EVIDENCE_DIR/domain-uptime-observations.json"
first=1
while IFS=$'\t' read -r check_id true_points false_points; do
  if [[ "$first" = 0 ]]; then echo ',' >> "$EVIDENCE_DIR/domain-uptime-observations.json"; fi
  jq -n --arg checkId "$check_id" --argjson truePoints "$true_points" --argjson falsePoints "$false_points" '{checkId:$checkId,truePoints:$truePoints,falsePoints:$falsePoints,observedPass:($truePoints>0)}' >> "$EVIDENCE_DIR/domain-uptime-observations.json"
  first=0
done < /tmp/uptime-observations.tsv
echo ']}' >> "$EVIDENCE_DIR/domain-uptime-observations.json"

jq -n --arg project "$PROJECT_ID" --arg projectNumber "$PROJECT_NUMBER" --arg operator "$STAGING_OPERATOR_SA" --arg dashboard "$DASH_NAME" --arg globalUptime "$GLOBAL_UPTIME" --argjson requiredRoles "$EXPECTED_ROLES" '{schemaVersion:"toca.staging.runtime-observability.evidence.v3",project:$project,projectNumber:$projectNumber,operator:$operator,dashboard:{name:$dashboard,readback:true,fullSliCoverage:true},globalUptime:{name:$globalUptime,observedPass:true},requiredAlertRoles:$requiredRoles,domainChecksObserved:true,policyIdentityPreserved:true,productionMutation:false,providerMutation:false,databaseMutation:false,backupMutation:false,drRestore:false,trafficMutation:false,cloudRunMutation:false,secretMutation:false,publicWebhookExposure:false,result:"FULL_RELIABILITY_COVERAGE_CONFIGURED_AND_READ_BACK"}' > "$EVIDENCE_DIR/manifest.json"
jq '[.alertPolicies[]? | select(.enabled==true and .userLabels.toca_managed=="staging_reliability") | {name,displayName,userLabels,notificationChannels}]' /tmp/staging-alert-policies-after.json > "$EVIDENCE_DIR/alert-policies.json"
jq '{name,displayName,labels,tileCount:(.mosaicLayout.tiles|length)}' /tmp/dashboard-readback.json > "$EVIDENCE_DIR/dashboard.json"
cp /tmp/domain-uptimes.tsv "$EVIDENCE_DIR/domain-uptimes.tsv"
rm -f "$EVIDENCE_DIR/SHA256SUMS"
echo 'STAGING_RUNTIME_OBSERVABILITY_V3=FULL_RELIABILITY_COVERAGE_CONFIGURED_AND_READ_BACK'
