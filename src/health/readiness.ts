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
  const failed = results.some((result) => !result.ok);
  return {
    status: failed ? 'not_ready' : 'ready',
    checks: results,
  };
}
