export type ControlResult = 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'UNKNOWN';

export interface ControlEvidence {
  readonly controlId: string;
  readonly result: ControlResult;
  readonly mandatory: boolean;
  readonly checkedAt: string;
  readonly evidence: readonly string[];
  readonly reason?: string;
}

export interface SecurityPostureReport {
  readonly state: 'SECURITY_POSTURE_VALIDATED' | 'REMEDIATION_REQUIRED';
  readonly failedControls: readonly string[];
  readonly unknownControls: readonly string[];
  readonly evidence: readonly string[];
}

export function evaluateSecurityPosture(
  controls: readonly ControlEvidence[],
): SecurityPostureReport {
  assertUniqueControlIds(controls);
  const failedControls = controls
    .filter((control) => control.mandatory && control.result === 'FAIL')
    .map((control) => control.controlId)
    .sort();
  const unknownControls = controls
    .filter((control) => control.mandatory && control.result === 'UNKNOWN')
    .map((control) => control.controlId)
    .sort();
  for (const control of controls) {
    if (control.result === 'PASS' && control.evidence.length === 0)
      throw new Error(`SECURITY_CONTROL_EVIDENCE_REQUIRED:${control.controlId}`);
  }
  return {
    state:
      failedControls.length === 0 && unknownControls.length === 0
        ? 'SECURITY_POSTURE_VALIDATED'
        : 'REMEDIATION_REQUIRED',
    failedControls,
    unknownControls,
    evidence: [...new Set(controls.flatMap((control) => control.evidence))].sort(),
  };
}

export interface RecoveryProof {
  readonly component: string;
  readonly backupVerified: boolean;
  readonly restoreExecuted: boolean;
  readonly integrityVerified: boolean;
  readonly targetRpoMinutes: number;
  readonly measuredRpoMinutes: number;
  readonly targetRtoMinutes: number;
  readonly measuredRtoMinutes: number;
  readonly testedAt: string;
  readonly evidence: readonly string[];
}

export interface RecoveryReadinessReport {
  readonly state: 'RECOVERY_VALIDATED' | 'GAPS_RECORDED';
  readonly gaps: readonly string[];
  readonly evidence: readonly string[];
}

export function evaluateRecoveryReadiness(
  proofs: readonly RecoveryProof[],
): RecoveryReadinessReport {
  if (proofs.length === 0) throw new Error('RECOVERY_PROOF_REQUIRED');
  const gaps: string[] = [];
  for (const proof of proofs) {
    if (!proof.backupVerified) gaps.push(`${proof.component}:BACKUP_NOT_VERIFIED`);
    if (!proof.restoreExecuted) gaps.push(`${proof.component}:RESTORE_NOT_EXECUTED`);
    if (!proof.integrityVerified) gaps.push(`${proof.component}:INTEGRITY_NOT_VERIFIED`);
    if (proof.measuredRpoMinutes > proof.targetRpoMinutes)
      gaps.push(`${proof.component}:RPO_TARGET_MISSED`);
    if (proof.measuredRtoMinutes > proof.targetRtoMinutes)
      gaps.push(`${proof.component}:RTO_TARGET_MISSED`);
    if (proof.evidence.length === 0) gaps.push(`${proof.component}:EVIDENCE_MISSING`);
  }
  return {
    state: gaps.length === 0 ? 'RECOVERY_VALIDATED' : 'GAPS_RECORDED',
    gaps: gaps.sort(),
    evidence: [...new Set(proofs.flatMap((proof) => proof.evidence))].sort(),
  };
}

export interface RegistryResourceRecord {
  readonly resourceId: string;
  readonly title: string;
  readonly owner: string | null;
  readonly status: string;
  readonly logicalPath: string | null;
  readonly driveId: string | null;
  readonly githubRef: string | null;
  readonly providerId: string | null;
  readonly canonical: boolean;
  readonly exists: boolean;
  readonly lastValidatedAt: string | null;
}

export type RegistryIssueCode =
  | 'DUPLICATE_RESOURCE_ID'
  | 'DUPLICATE_DRIVE_ID'
  | 'OWNER_MISSING'
  | 'STATUS_INVALID'
  | 'PATH_MISSING'
  | 'RESOURCE_NOT_FOUND'
  | 'LAST_VALIDATED_MISSING'
  | 'STALE_VALIDATION'
  | 'CANONICAL_CONFLICT';

export interface RegistryIssue {
  readonly code: RegistryIssueCode;
  readonly resourceIds: readonly string[];
  readonly detail: string;
}

export interface RegistryValidationReport {
  readonly state: 'VALID' | 'DIFF';
  readonly issues: readonly RegistryIssue[];
}

const validRegistryStatuses = new Set([
  'ACTIVE_CANONICAL',
  'ACTIVE_OPERATIONAL',
  'SUPERSEDED',
  'DEPRECATED',
  'ARCHIVED',
  'REMOVED',
]);

export function validateMasterDataRegistry(
  resources: readonly RegistryResourceRecord[],
  options: { readonly now?: string; readonly maxAgeDays?: number } = {},
): RegistryValidationReport {
  const now = Date.parse(options.now ?? new Date().toISOString());
  const maxAgeMs = (options.maxAgeDays ?? 31) * 86_400_000;
  const issues: RegistryIssue[] = [];
  addDuplicateIssues(resources, 'resourceId', 'DUPLICATE_RESOURCE_ID', issues);
  addDuplicateIssues(
    resources.filter((resource) => resource.driveId),
    'driveId',
    'DUPLICATE_DRIVE_ID',
    issues,
  );

  for (const resource of resources) {
    if (!resource.owner)
      issues.push({
        code: 'OWNER_MISSING',
        resourceIds: [resource.resourceId],
        detail: 'Owner obrigatório ausente.',
      });
    if (!validRegistryStatuses.has(resource.status))
      issues.push({
        code: 'STATUS_INVALID',
        resourceIds: [resource.resourceId],
        detail: `Status inválido: ${resource.status}.`,
      });
    if (!resource.logicalPath)
      issues.push({
        code: 'PATH_MISSING',
        resourceIds: [resource.resourceId],
        detail: 'Logical path obrigatório ausente.',
      });
    if (!resource.exists && resource.status.startsWith('ACTIVE'))
      issues.push({
        code: 'RESOURCE_NOT_FOUND',
        resourceIds: [resource.resourceId],
        detail: 'Recurso ACTIVE não existe na fonte declarada.',
      });
    if (!resource.lastValidatedAt)
      issues.push({
        code: 'LAST_VALIDATED_MISSING',
        resourceIds: [resource.resourceId],
        detail: 'lastValidatedAt obrigatório ausente.',
      });
    else if (now - Date.parse(resource.lastValidatedAt) > maxAgeMs)
      issues.push({
        code: 'STALE_VALIDATION',
        resourceIds: [resource.resourceId],
        detail: `Validação excedeu ${options.maxAgeDays ?? 31} dias.`,
      });
  }

  const canonicalByTitle = new Map<string, string[]>();
  for (const resource of resources.filter((candidate) => candidate.canonical))
    canonicalByTitle.set(resource.title, [
      ...(canonicalByTitle.get(resource.title) ?? []),
      resource.resourceId,
    ]);
  for (const [title, ids] of canonicalByTitle) {
    if (ids.length > 1)
      issues.push({
        code: 'CANONICAL_CONFLICT',
        resourceIds: ids.sort(),
        detail: `Múltiplos canônicos para ${title}.`,
      });
  }
  return { state: issues.length === 0 ? 'VALID' : 'DIFF', issues };
}

function assertUniqueControlIds(controls: readonly ControlEvidence[]): void {
  if (new Set(controls.map((control) => control.controlId)).size !== controls.length)
    throw new Error('SECURITY_CONTROL_DUPLICATE');
}

function addDuplicateIssues(
  resources: readonly RegistryResourceRecord[],
  field: 'resourceId' | 'driveId',
  code: 'DUPLICATE_RESOURCE_ID' | 'DUPLICATE_DRIVE_ID',
  issues: RegistryIssue[],
): void {
  const grouped = new Map<string, string[]>();
  for (const resource of resources) {
    const value = resource[field];
    if (!value) continue;
    grouped.set(value, [...(grouped.get(value) ?? []), resource.resourceId]);
  }
  for (const [value, ids] of grouped) {
    if (ids.length > 1)
      issues.push({ code, resourceIds: ids.sort(), detail: `Valor duplicado: ${value}.` });
  }
}
