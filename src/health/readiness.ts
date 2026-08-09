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
  return {
    status: results.every((result) => result.ok) ? 'ready' : 'not_ready',
    checks: results,
  };
}
