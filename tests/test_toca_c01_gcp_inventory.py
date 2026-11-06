"""Focused regression checks for C01 read-only, sanitized GCP metadata collection."""

import importlib.util
import hashlib
from pathlib import Path
import re
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / "scripts/toca-c01-gcp-runtime-inventory.py"
WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/toca-c01-gcp-runtime-readback.yml"
spec = importlib.util.spec_from_file_location("c01_inventory", SOURCE)
c01 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c01)
MAIN = "a" * 40


class C01InventoryTests(unittest.TestCase):
    def test_gcloud_rejects_mutating_commands_and_unsafe_names(self):
        for resource, verb, name in [
            ("jobs", "execute", "safe"),
            ("services", "update", "safe"),
            ("services", "describe", "unsafe;echo hi"),
        ]:
            with self.assertRaises(ValueError):
                c01.run_gcloud(resource, verb, name)

    def test_extracts_only_sha_and_digest_without_secret_environment(self):
        container = {
            "image": "example/image@sha256:" + "c" * 64,
            "env": [
                {"name": "DATABASE_URL", "value": "super-secret"},
                {"name": "TOCA_RELEASE_SHA", "value": MAIN},
            ],
        }
        self.assertEqual(c01.code_sha(container), MAIN)
        self.assertEqual(c01.image_digest({"status": {}}, container), "sha256:" + "c" * 64)
        self.assertNotIn("super-secret", str(c01.code_sha(container)))

    def test_service_readback_is_bounded_and_does_not_expose_secrets(self):
        service = {
            "metadata": {"name": "toca-mcp-production", "creationTimestamp": "2026-11-06T13:00:00Z"},
            "status": {
                "latestReadyRevisionName": "toca-mcp-production-00001-aab",
                "latestCreatedRevisionName": "toca-mcp-production-00001-aab",
                "conditions": [{"type": "Ready", "status": "True"}],
                "traffic": [{"revisionName": "toca-mcp-production-00001-aab", "percent": 100}],
            },
            "spec": {"template": {"spec": {"serviceAccountName": "runtime@example.invalid"}}},
        }
        revision = {
            "metadata": {"name": "toca-mcp-production-00001-aab"},
            "status": {"imageDigest": "sha256:" + "d" * 64, "conditions": [{"type": "Ready", "status": "True"}]},
            "spec": {
                "serviceAccountName": "runtime@example.invalid",
                "containers": [{"image": "image:tag", "env": [
                    {"name": "TOCA_RELEASE_SHA", "value": MAIN},
                    {"name": "META_APP_SECRET", "value": "never-publish"},
                ]}],
            },
        }
        def fixture(resource, verb, name=None):
            return service if resource == "services" else revision
        with patch.object(c01, "run_gcloud", side_effect=fixture):
            snapshot = c01.service_snapshot("toca-mcp-production", MAIN)
        self.assertEqual(snapshot["platformReady"], "True")
        self.assertEqual(snapshot["revisions"][0]["matchesMainSha"], True)
        self.assertNotIn("never-publish", str(snapshot))

    def test_source_never_contains_mutating_gcloud_invocations(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn('verb not in {"list", "describe"}', source)
        for forbidden in ["gcloud run jobs execute", "gcloud run jobs deploy", "gcloud run services update", "gcloud iam roles"]:
            self.assertNotIn(forbidden, source)

    def test_workflow_rejects_reruns_and_non_owner_triggering_actor(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertIn("github.actor == github.repository_owner", workflow)
        self.assertIn("github.triggering_actor == github.repository_owner", workflow)
        self.assertIn("github.run_attempt == 1", workflow)
        self.assertIn("environment: production", workflow)
        self.assertIn("TOCA_C01_READ_ONLY_AUTHORIZED", workflow)
        self.assertIn("inputs.recipient_certificate_base64 != ''", workflow)

    def test_public_receipt_commits_to_private_report_without_exposing_topology(self):
        report = {
            "capturedUtc": "2026-11-06T13:00:00+00:00",
            "controllerMainSha": MAIN,
            "services": [{"service": "private-service", "runtimeServiceAccount": "secret@example.invalid"}],
            "jobNames": ["private-job"],
            "traffic": [{"revisionName": "private-revision", "percent": 100}],
            "imageDigest": "sha256:" + "e" * 64,
        }
        raw = b"synthetic-private-report"
        receipt = c01.public_receipt(report, raw, "12345", "1")
        self.assertEqual(receipt["privateReportSha256"], hashlib.sha256(raw).hexdigest())
        self.assertTrue(receipt["gcpMetadataReadCalls"])
        self.assertFalse(receipt["gcpProviderMutations"])
        self.assertNotIn("private-service", str(receipt))
        self.assertNotIn("secret@example.invalid", str(receipt))
        self.assertNotIn("private-job", str(receipt))
        self.assertNotIn("private-revision", str(receipt))
        self.assertNotIn("sha256:" + "e" * 64, str(receipt))

    def test_public_receipt_requires_unique_owner_run_attempt(self):
        report = {"capturedUtc": "now", "controllerMainSha": MAIN}
        for run_id, attempt in [("", "1"), ("23", "2"), ("non-number", "1")]:
            with self.assertRaises(ValueError):
                c01.public_receipt(report, b"private", run_id, attempt)

    def test_workflow_never_uploads_plaintext_topology_to_public_repository(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("openssl cms -encrypt -binary -aes-256-cbc", workflow)
        self.assertIn("rm -- toca-c01-readback.json", workflow)
        artifact_step = workflow.split("- name: Store encrypted inventory and public-safe receipt only", 1)[1]
        self.assertIn("toca-c01-readback.p7m", artifact_step)
        self.assertIn("toca-c01-public-receipt.json", artifact_step)
        self.assertNotIn("toca-c01-readback.json", artifact_step)

    def test_provider_readback_does_not_misrepresent_real_gcp_queries(self):
        with patch.object(c01, "run_gcloud", return_value=[]) as call:
            report = c01.collect(MAIN)
        self.assertEqual(call.call_count, 2)
        self.assertEqual(report["schemaVersion"], "toca.c01.gcp-readback.v1")
        self.assertTrue(report["gcpMetadataReadCalls"])
        self.assertFalse(report["providerMutations"])
        self.assertNotIn("providerCalls", report)


if __name__ == "__main__":
    unittest.main()
