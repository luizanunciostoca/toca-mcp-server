import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const daemonSource = readFileSync('src/toca-managed-instagram-daemon.ts', 'utf8');

describe('TOCA managed Instagram daemon engagement isolation', () => {
  it('attempts engagement before the publication worker so publication failures cannot block claims', () => {
    const engagementRun = daemonSource.indexOf('await engagementRuntime.runBatch()');
    const publicationRun = daemonSource.indexOf('await runTocaManagedInstagramWorkerBatch({');

    expect(engagementRun).toBeGreaterThan(-1);
    expect(publicationRun).toBeGreaterThan(-1);
    expect(engagementRun).toBeLessThan(publicationRun);
  });

  it('isolates component failures while preserving an overall failed tick', () => {
    const required = [
      'let engagementError: string | null = null;',
      'let publicationError: string | null = null;',
      "telemetry.increment('daemon.engagement.tick_failed')",
      "telemetry.increment('daemon.publication.tick_failed')",
      'engagement:${engagementError}',
      'publication:${publicationError}',
      "throw new Error(componentErrors.join('|'))",
    ];

    for (const token of required) expect(daemonSource).toContain(token);
  });

  it('returns observed component counters on a failed tick instead of erasing claim evidence', () => {
    const failedTickStart = daemonSource.indexOf("telemetry.increment('daemon.tick.failed')");
    const failedTickEnd = daemonSource.indexOf(
      "telemetry.record('daemon.tick.duration_ms'",
      failedTickStart,
    );

    expect(failedTickStart).toBeGreaterThan(-1);
    expect(failedTickEnd).toBeGreaterThan(failedTickStart);

    const failedTick = daemonSource.slice(failedTickStart, failedTickEnd);
    expect(failedTick).toContain('claimed: lastClaimed');
    expect(failedTick).toContain('engagementClaimed: lastEngagementClaimed');
    expect(failedTick).toContain('engagementSucceeded: lastEngagementSucceeded');
    expect(failedTick).toContain('engagementFailed: lastEngagementFailed');
  });
});
