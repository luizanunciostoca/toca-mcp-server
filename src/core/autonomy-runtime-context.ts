import {
  AUTONOMY_MODES,
  loadEffectiveAutonomyPolicy,
  type AutonomyMode,
} from '../governance/autonomy-policy.js';
import {
  evaluateAutopilotReadiness,
  readinessChecksFromRecord,
  type AutopilotReadinessCheck,
} from '../health/autopilot-readiness.js';
import type { ProviderHealthEvidence } from './autonomy-gate.js';
import type { ExecutionIdentity } from './identity.js';
import type { ToolDefinition } from './tool-registry.js';

export interface AutonomyRuntimeContextInput {
  readonly tool: ToolDefinition;
  readonly identity: ExecutionIdentity;
}

export interface AutonomyRuntimeContext {
  readonly policyVersion: string;
  readonly autonomyMode: AutonomyMode;
  readonly readiness?: ReturnType<typeof evaluateAutopilotReadiness>;
  readonly providerHealth?: ProviderHealthEvidence;
  readonly tenantKillSwitch: boolean;
  readonly providerKillSwitches: readonly string[];
  readonly capabilityKillSwitches: readonly string[];
}

export type AutonomyRuntimeContextResolver = (
  input: AutonomyRuntimeContextInput,
) => AutonomyRuntimeContext | Promise<AutonomyRuntimeContext>;

export function createEnvironmentAutonomyRuntimeContextResolver(
  env: NodeJS.ProcessEnv = process.env,
): AutonomyRuntimeContextResolver {
  const policy = loadEffectiveAutonomyPolicy();
  const autonomyMode = parseMode(env.TOCA_AUTONOMY_MODE, policy.policy.modes.default);
  const policyVersion = env.TOCA_AUTOPILOT_POLICY_VERSION?.trim() || policy.policy.policyVersion;
  const readiness = parseReadiness(env.TOCA_AUTOPILOT_READINESS_JSON, policy);
  const providerHealth = parseProviderHealth(env.TOCA_PROVIDER_HEALTH_JSON);
  const providerKillSwitches = csv(env.TOCA_PROVIDER_KILL_SWITCHES);
  const capabilityKillSwitches = csv(env.TOCA_CAPABILITY_KILL_SWITCHES);
  const disabledTenants = csv(env.TOCA_TENANT_KILL_SWITCHES);

  return ({ tool, identity }) => {
    const matchingProviderHealth = providerHealth.find(
      (candidate) =>
        candidate.provider === tool.provider && candidate.tenantId === identity.principal.tenantId,
    );
    return {
      policyVersion,
      autonomyMode,
      ...(readiness ? { readiness } : {}),
      ...(matchingProviderHealth ? { providerHealth: matchingProviderHealth } : {}),
      tenantKillSwitch: disabledTenants.includes(identity.principal.tenantId),
      providerKillSwitches,
      capabilityKillSwitches,
    };
  };
}

function parseReadiness(
  value: string | undefined,
  policy: ReturnType<typeof loadEffectiveAutonomyPolicy>,
): ReturnType<typeof evaluateAutopilotReadiness> | undefined {
  if (!value?.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('AUTOPILOT_READINESS_JSON_INVALID');
  }
  if (!isRecord(parsed)) throw new Error('AUTOPILOT_READINESS_JSON_INVALID');
  const now = new Date().toISOString();
  const record: Partial<
    Record<
      AutopilotReadinessCheck['name'],
      Omit<AutopilotReadinessCheck, 'name' | 'checkedAt'> & { readonly checkedAt?: string }
    >
  > = {};
  for (const [name, raw] of Object.entries(parsed)) {
    if (!isRecord(raw)) throw new Error(`AUTOPILOT_READINESS_JSON_CHECK_INVALID:${name}`);
    const status = raw.status;
    const evidence = raw.evidence;
    if (
      (status !== 'PASS' && status !== 'FAIL' && status !== 'UNKNOWN') ||
      !Array.isArray(evidence) ||
      !evidence.every((item) => typeof item === 'string')
    ) {
      throw new Error(`AUTOPILOT_READINESS_JSON_CHECK_INVALID:${name}`);
    }
    record[name as AutopilotReadinessCheck['name']] = {
      status,
      evidence,
      ...(typeof raw.reasonCode === 'string' ? { reasonCode: raw.reasonCode } : {}),
      ...(typeof raw.checkedAt === 'string' ? { checkedAt: raw.checkedAt } : {}),
    };
  }
  return evaluateAutopilotReadiness(readinessChecksFromRecord(record, now), {
    now,
    policy,
  });
}

function parseProviderHealth(value: string | undefined): readonly ProviderHealthEvidence[] {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('PROVIDER_HEALTH_JSON_INVALID');
  }
  if (!Array.isArray(parsed)) throw new Error('PROVIDER_HEALTH_JSON_INVALID');
  return parsed.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`PROVIDER_HEALTH_ENTRY_INVALID:${index}`);
    const { provider, tenantId, status, circuit, evidence, checkedAt } = raw;
    if (
      typeof provider !== 'string' ||
      typeof tenantId !== 'string' ||
      !['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN'].includes(String(status)) ||
      !['CLOSED', 'OPEN', 'HALF_OPEN'].includes(String(circuit)) ||
      !Array.isArray(evidence) ||
      !evidence.every((item) => typeof item === 'string') ||
      typeof checkedAt !== 'string' ||
      !Number.isFinite(Date.parse(checkedAt))
    ) {
      throw new Error(`PROVIDER_HEALTH_ENTRY_INVALID:${index}`);
    }
    return {
      provider,
      tenantId,
      status: status as ProviderHealthEvidence['status'],
      circuit: circuit as ProviderHealthEvidence['circuit'],
      evidence,
      checkedAt,
    };
  });
}

function parseMode(value: string | undefined, fallback: AutonomyMode): AutonomyMode {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (!AUTONOMY_MODES.includes(normalized as AutonomyMode)) {
    throw new Error(`AUTONOMY_MODE_INVALID:${normalized}`);
  }
  return normalized as AutonomyMode;
}

function csv(value: string | undefined): readonly string[] {
  return [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
