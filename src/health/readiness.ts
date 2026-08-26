export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

export interface ReadinessReport {
  readonly status: 'ready' | 'not_ready';
  readonly checks: ReadonlyArray<{ readonly name: string; readonly ok: boolean }>;
}

export async function evaluateReadiness(
  checks: readonly ReadinessCheck[],
): Promise<ReadinessReport> {
  const results = await Promise.all(
    checks.map(async (check) => {
      try {
        await check.check();
        return { name: check.name, ok: true } as const;
      } catch {
        return { name: check.name, ok: false } as const;
      }
    }),
  );
  const failedChecks = results.filter((result) => !result.ok).map((result) => result.name);
  const status = failedChecks.length === 0 ? 'ready' : 'not_ready';
  if (status === 'not_ready') {
    console.warn(`TOCA_READINESS_NOT_READY failed_checks=${failedChecks.join(',')}`);
  }
  return {
    status,
    checks: results,
  };
}
