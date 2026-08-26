from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    file.write_text(text.replace(old, new, 1))


replace_once(
    'test/gcp-deploy-cloud-run-probes.test.ts',
    "    expect(workflow.match(/--startup-probe/g)).toHaveLength(3);\n    expect(workflow.match(/--liveness-probe/g)).toHaveLength(3);",
    "    expect(workflow.match(/--startup-probe/g)).toHaveLength(4);\n    expect(workflow.match(/--liveness-probe/g)).toHaveLength(4);",
    'Cloud Run probe counts',
)
replace_once(
    'test/gcp-deploy-cloud-run-probes.test.ts',
    "    expect(workflow).toContain('gcloud run deploy \"$PROBE_SERVICE\" --image \"$IMAGE\"');",
    "    expect(workflow).toContain('gcloud run deploy \"$PROBE_SERVICE\" --image \"$IMAGE\"');\n    expect(workflow).toContain(\n      'gcloud run deploy \"$WEBHOOK_PROBE_SERVICE\" --image \"$IMAGE\"',\n    );",
    'webhook acceptance sibling assertion',
)

replace_once(
    'test/gcp-production-probe-rollback-contract.test.ts',
    '    expect(readinessStartupProbes).toHaveLength(1);',
    '    expect(readinessStartupProbes).toHaveLength(2);',
    'readiness startup count',
)

replace_once(
    'test/gcp-production-internal-probe-contract.test.ts',
    "    expect(verify).toContain('trap cleanup_internal_mcp_probe EXIT');\n    expect(verify).toContain('gcloud run services delete \"$PROBE_SERVICE\"');\n    expect(verify).not.toContain('gcloud scheduler jobs delete');",
    "    expect(verify).toContain('trap cleanup_internal_mcp_probe EXIT');\n    expect(verify).toContain('gcloud run services delete \"$PROBE_SERVICE\"');\n    const mcpCleanupStart = verify.indexOf('cleanup_internal_mcp_probe()');\n    const mcpCleanupEnd = verify.indexOf('trap cleanup_internal_mcp_probe EXIT', mcpCleanupStart);\n    expect(mcpCleanupStart).toBeGreaterThan(-1);\n    expect(mcpCleanupEnd).toBeGreaterThan(mcpCleanupStart);\n    const mcpCleanup = verify.slice(mcpCleanupStart, mcpCleanupEnd);\n    expect(mcpCleanup).not.toContain('gcloud scheduler jobs delete');",
    'MCP cleanup scope',
)
