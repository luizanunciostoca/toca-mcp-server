#!/usr/bin/env python3
"""Bounded read-only Cloud Run inventory. Never output provider env/secrets/log payloads."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys

PROJECT = "toca-mcp-production"
REGION = "southamerica-east1"
SHA = re.compile(r"^[a-f0-9]{40}$")
NAME = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
DETAIL_LIMIT = 40


def run_gcloud(resource: str, verb: str, name: str | None = None) -> list | dict:
    if resource not in {"services", "revisions", "jobs"} or verb not in {"list", "describe"}:
        raise ValueError("C01_FORBIDDEN_GCLOUD_VERB")
    if (verb == "describe") != (name is not None):
        raise ValueError("C01_INVALID_GCLOUD_TARGET")
    if name is not None and NAME.fullmatch(name) is None:
        raise ValueError("C01_INVALID_RESOURCE_NAME")
    command = ["gcloud", "run", resource, verb]
    if name is not None:
        command.append(name)
    command += ["--project", PROJECT, "--region", REGION, "--format=json"]
    try:
        result = subprocess.run(
            command, check=False, capture_output=True, text=True, timeout=90
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"C01_GCP_READ_UNAVAILABLE:{resource}:{verb}") from exc
    if result.returncode != 0:
        # Never surface arbitrary gcloud stderr or raw provider payloads.
        raise RuntimeError(f"C01_GCP_READ_FAILED:{resource}:{verb}:rc={result.returncode}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"C01_GCP_INVALID_JSON:{resource}:{verb}") from exc


def named(obj: dict) -> str:
    raw = obj.get("metadata", {}).get("name") or obj.get("name") or ""
    candidate = str(raw).rsplit("/", 1)[-1]
    if NAME.fullmatch(candidate) is None:
        raise ValueError("C01_INVALID_RESOURCE_NAME_IN_PROVIDER_LIST")
    return candidate


def first_container(obj: dict) -> dict:
    """Find the first Cloud Run v1/v2 container; never read its environment values wholesale."""
    possible = [
        obj.get("spec", {}).get("containers"),
        obj.get("spec", {}).get("template", {}).get("spec", {}).get("containers"),
        obj.get("spec", {}).get("template", {}).get("spec", {}).get("template", {}).get("spec", {}).get("containers"),
        obj.get("template", {}).get("containers"),
        obj.get("template", {}).get("template", {}).get("containers"),
    ]
    for containers in possible:
        if isinstance(containers, list) and containers and isinstance(containers[0], dict):
            return containers[0]
    return {}


def code_sha(container: dict) -> str | None:
    approved = {"TOCA_RELEASE_SHA", "SOURCE_SHA", "GITHUB_SHA"}
    matches = {
        entry.get("value")
        for entry in container.get("env", [])
        if isinstance(entry, dict) and entry.get("name") in approved
        and isinstance(entry.get("value"), str) and SHA.fullmatch(entry["value"])
    }
    return next(iter(matches)) if len(matches) == 1 else None


def image_digest(obj: dict, container: dict) -> str | None:
    status = obj.get("status", {})
    choices = [status.get("imageDigest"), container.get("image")]
    if isinstance(status.get("containerStatuses"), list):
        choices += [x.get("imageDigest") for x in status["containerStatuses"] if isinstance(x, dict)]
    for value in choices:
        if isinstance(value, str):
            match = DIGEST.search(value)
            if match:
                return match.group()
    return None


def ready(obj: dict) -> str:
    statuses = [
        condition.get("status")
        for condition in obj.get("status", {}).get("conditions", [])
        if isinstance(condition, dict) and condition.get("type") == "Ready"
    ]
    value = statuses[-1] if statuses else None
    return str(value) if str(value) in {"True", "False", "Unknown"} else "NOT_PROVEN"


def revision_snapshot(name: str, main_sha: str) -> dict:
    data = run_gcloud("revisions", "describe", name)
    container = first_container(data)
    source_sha = code_sha(container)
    return {
        "revision": name,
        "createdUtc": data.get("metadata", {}).get("creationTimestamp"),
        "imageDigest": image_digest(data, container),
        "imageReference": container.get("image"),
        "runtimeServiceAccount": data.get("spec", {}).get("serviceAccountName"),
        "platformReady": ready(data),
        "releaseSha": source_sha,
        "matchesMainSha": source_sha == main_sha if source_sha is not None else None,
    }


def service_snapshot(name: str, main_sha: str) -> dict:
    data = run_gcloud("services", "describe", name)
    status = data.get("status", {})
    traffic = [
        {
            "revision": item.get("revisionName"),
            "percent": item.get("percent", 0),
            "tag": item.get("tag"),
            "latestRevision": item.get("latestRevision"),
        }
        for item in status.get("traffic", [])
        if isinstance(item, dict)
    ]
    names = set(filter(None, [status.get("latestReadyRevisionName")]))
    names.update(item["revision"] for item in traffic if item.get("revision"))
    revisions = [revision_snapshot(rev, main_sha) for rev in sorted(names)]
    template = data.get("spec", {}).get("template", {}).get("spec", {})
    return {
        "service": name,
        "createdUtc": data.get("metadata", {}).get("creationTimestamp"),
        "latestCreatedRevision": status.get("latestCreatedRevisionName"),
        "latestReadyRevision": status.get("latestReadyRevisionName"),
        "runtimeServiceAccount": template.get("serviceAccountName"),
        "platformReady": ready(data),
        "traffic": traffic,
        "revisions": revisions,
        "httpHealthAndReady": "NOT_PROVEN_PRIVATE_ENDPOINTS_NOT_INVOKED",
    }


def job_snapshot(name: str) -> dict:
    data = run_gcloud("jobs", "describe", name)
    container = first_container(data)
    spec = data.get("spec", {}).get("template", {}).get("spec", {}).get("template", {}).get("spec", {})
    return {
        "job": name,
        "createdUtc": data.get("metadata", {}).get("creationTimestamp"),
        "imageReference": container.get("image"),
        "imageDigest": image_digest(data, container),
        "runtimeServiceAccount": spec.get("serviceAccountName"),
        "releaseSha": code_sha(container),
        "publicationWritesEnabled": next(
            (e.get("value") for e in container.get("env", [])
             if isinstance(e, dict) and e.get("name") == "INSTAGRAM_PUBLICATION_WRITES_ENABLED"
             and e.get("value") in {"true", "false"}),
            "NOT_PROVEN",
        ),
    }


def collect(main_sha: str) -> dict:
    raw_services = run_gcloud("services", "list")
    raw_jobs = run_gcloud("jobs", "list")
    if not isinstance(raw_services, list) or not isinstance(raw_jobs, list):
        raise RuntimeError("C01_UNEXPECTED_GCP_LIST_SHAPE")
    services = sorted({named(service) for service in raw_services})
    jobs = sorted({named(job) for job in raw_jobs})
    prioritized_jobs = sorted(jobs, key=lambda name: (not bool(re.search(r"publish|instagram|duplicate", name)), name))
    selected_jobs = prioritized_jobs[:DETAIL_LIMIT]
    return {
        "schemaVersion": "toca.c01.gcp-readback.v1",
        "capturedUtc": datetime.now(timezone.utc).isoformat(),
        "project": PROJECT,
        "region": REGION,
        "controllerMainSha": main_sha,
        "readOnly": True,
        # This report is evidence from real GCP provider metadata READ calls.
        # A read must not be recorded as an absence of provider interaction.
        "gcpMetadataReadCalls": True,
        "providerMutations": False,
        "serviceMutations": False,
        "databaseMutations": False,
        "iamMutations": False,
        "trafficMutations": False,
        "servicesCount": len(services),
        "services": [service_snapshot(name, main_sha) for name in services],
        "jobsCount": len(jobs),
        "jobNames": jobs,
        "jobDetails": [job_snapshot(name) for name in selected_jobs],
        "jobDetailsComplete": len(jobs) <= DETAIL_LIMIT,
        "httpHealthAndReady": "NOT_PROVEN_PLATFORM_CONDITIONS_ONLY",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--main-sha", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.project != PROJECT or args.region != REGION or not SHA.fullmatch(args.main_sha):
        raise ValueError("C01_UNAUTHORIZED_PROJECT_REGION_OR_SHA")
    path = Path(args.output)
    if path.is_absolute() or ".." in path.parts or path.suffix != ".json":
        raise ValueError("C01_INVALID_OUTPUT_TARGET")
    report = collect(args.main_sha)
    path.write_text(json.dumps(report, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print("C01_GCP_METADATA_READBACK=CAPTURED")
    print(f"C01_SERVICE_COUNT={report['servicesCount']}")
    print(f"C01_JOB_COUNT={report['jobsCount']}")
    print(f"C01_JOB_DETAILS_COMPLETE={str(report['jobDetailsComplete']).lower()}")
    print("C01_HTTP_HEALTH_READY=NOT_PROVEN")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
