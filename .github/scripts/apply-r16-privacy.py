from pathlib import Path
import re

IDS = [
    'privacy.purpose.resolve',
    'privacy.legal_basis.record',
    'privacy.consent.record',
    'privacy.consent.revoke',
    'privacy.suppression.check',
    'privacy.preference.update',
    'privacy.retention.apply',
    'privacy.subject_request.create',
    'privacy.subject_request.status',
    'privacy.data_export.prepare',
    'privacy.data_delete.execute',
    'privacy.automated_decision.explain',
    'privacy.profiling.review',
]


def patch_ids():
    p = Path('src/governance/capability-ids.ts')
    text = p.read_text()
    if "'privacy.purpose.resolve'" in text:
        return
    marker = "    'legal.escalate_to_counsel',\n  ],\n  R17: ["
    if marker not in text:
        raise SystemExit('R16_LEGAL_MARKER_NOT_FOUND')
    privacy = ''.join(f"    '{x}',\n" for x in IDS)
    text = text.replace(marker, "    'legal.escalate_to_counsel',\n" + privacy + "  ],\n  R17: [", 1)
    p.write_text(text)


def patch_catalog():
    p = Path('src/governance/capability-catalog.ts')
    text = p.read_text()
    prefix = text.split('const runtimeDefinitions', 1)[0]
    if "'privacy.purpose.resolve'" not in prefix:
        marker = "const implementedInternal = new Set([\n"
        if marker not in text:
            raise SystemExit('IMPLEMENTED_INTERNAL_MARKER_NOT_FOUND')
        text = text.replace(marker, marker + ''.join(f"  '{x}',\n" for x in IDS), 1)
    evidence = "  if (capabilityId.startsWith('privacy.')) return ['src/privacy/privacy-governance.ts'];\n"
    if evidence not in text:
        marker = "  if (capabilityId.startsWith('release.')) return ['src/governance/release-lifecycle.ts'];\n"
        if marker not in text:
            raise SystemExit('EVIDENCE_MARKER_NOT_FOUND')
        text = text.replace(marker, marker + evidence, 1)
    p.write_text(text)


def patch_overrides():
    p = Path('src/governance/capability-contract-overrides.ts')
    text = p.read_text()
    if "'privacy.data_export.prepare':" in text:
        return
    marker = "  'story.export': {"
    if marker not in text:
        raise SystemExit('OVERRIDE_MARKER_NOT_FOUND')
    block = """  'privacy.data_export.prepare': {
    description:
      'Prepare a governed subject-data export artifact only after policy evaluation and descriptor-bound approval.',
    contract_quality: 'EXPLICIT',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: true,
    idempotent: false,
    provider: 'TOCA_OS+toca-mcp',
    operation: 'privacy.data_export.prepare',
    authentication_mode: 'INTERNAL',
    verification_method: 'ARTIFACT_READBACK_AND_AUDIT_EVIDENCE',
    rollback_method: 'DELETE_OR_SUPERSEDE_EXPORT_ARTIFACT',
  },
  'privacy.data_delete.execute': {
    description:
      'Execute an approved subject-data deletion through a governed data gateway while preserving mandatory retention evidence.',
    contract_quality: 'EXPLICIT',
    risk_class: 'DESTRUCTIVE',
    side_effects: true,
    approval_required: true,
    idempotent: false,
    provider: 'TOCA_OS+toca-mcp',
    operation: 'privacy.data_delete.execute',
    authentication_mode: 'INTERNAL',
    verification_method: 'DELETE_RECEIPT_AND_AUDIT_EVIDENCE',
    rollback_method: 'NOT_REVERSIBLE_REQUIRES_RECOVERY_OR_MANUAL_REVIEW',
  },
"""
    p.write_text(text.replace(marker, block + marker, 1))


def patch_governance_test():
    p = Path('test/governance-catalog.test.ts')
    text = p.read_text()
    if "getCapabilityDefinition('privacy.data_export.prepare')" in text:
        return
    title = re.search(r'materializes the (\d+)-capability catalog', text)
    count = re.search(r'expect\(CAPABILITY_CATALOG\)\.toHaveLength\((\d+)\);', text)
    if not title or not count:
        raise SystemExit('GOVERNANCE_COUNT_MARKER_NOT_FOUND')
    next_count = int(count.group(1)) + len(IDS)
    text = text[:title.start(1)] + str(next_count) + text[title.end(1):]
    count = re.search(r'expect\(CAPABILITY_CATALOG\)\.toHaveLength\((\d+)\);', text)
    text = text[:count.start(1)] + str(next_count) + text[count.end(1):]
    marker = """    expect(getCapabilityDefinition('release.deploy')).toMatchObject({
      risk_class: 'WRITE_EXTERNAL',
      approval_required: true,
    });
"""
    if marker not in text:
        raise SystemExit('GOVERNANCE_ASSERT_MARKER_NOT_FOUND')
    assertions = """
    expect(getCapabilityDefinition('privacy.data_export.prepare')).toMatchObject({
      route_id: 'R16',
      lifecycle_status: 'IMPLEMENTED',
      execution_surface: 'INTERNAL_ENGINE',
      risk_class: 'WRITE_REVERSIBLE',
      approval_required: true,
    });
    expect(getCapabilityDefinition('privacy.data_delete.execute')).toMatchObject({
      route_id: 'R16',
      lifecycle_status: 'IMPLEMENTED',
      execution_surface: 'INTERNAL_ENGINE',
      risk_class: 'DESTRUCTIVE',
      approval_required: true,
    });
"""
    p.write_text(text.replace(marker, marker + assertions, 1))


def patch_resolution_test():
    p = Path('test/capability-resolution.test.ts')
    text = p.read_text()
    if "privacy.purpose.resolve" in text:
        return
    raw = re.search(r'raw_count: (\d+),', text)
    effective = re.search(r'effective_count: (\d+),', text)
    title = re.search(r'preserves the (\d+) compatibility IDs', text)
    if not raw or not effective:
        raise SystemExit('RESOLUTION_COUNT_MARKER_NOT_FOUND')
    new_raw = int(raw.group(1)) + len(IDS)
    new_effective = int(effective.group(1)) + len(IDS)
    text = text[:raw.start(1)] + str(new_raw) + text[raw.end(1):]
    effective = re.search(r'effective_count: (\d+),', text)
    text = text[:effective.start(1)] + str(new_effective) + text[effective.end(1):]
    if title:
        title = re.search(r'preserves the (\d+) compatibility IDs', text)
        text = text[:title.start(1)] + str(new_raw) + text[title.end(1):]
    # marker makes the transform idempotent without adding an assertion that couples behavior.
    text += "\n// R16 privacy catalog extension includes privacy.purpose.resolve.\n"
    p.write_text(text)


patch_ids()
patch_catalog()
patch_overrides()
patch_governance_test()
patch_resolution_test()
