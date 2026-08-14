import { JsonConsoleLogger, type StructuredLogger } from './structured-logger.js';

export interface TelemetryAttributes {
  readonly [key: string]: string | number | boolean;
}

export interface Telemetry {
  increment(name: string, attributes?: TelemetryAttributes): void;
  record(name: string, value: number, attributes?: TelemetryAttributes): void;
}

export interface TelemetryObservation {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly last: number;
}

export interface TelemetrySnapshot {
  readonly counters: Readonly<Record<string, number>>;
  readonly observations: Readonly<Record<string, TelemetryObservation>>;
}

export class RuntimeTelemetry implements Telemetry {
  private readonly counters = new Map<string, number>();
  private readonly observations = new Map<string, TelemetryObservation>();

  constructor(private readonly logger: StructuredLogger = new JsonConsoleLogger()) {}

  increment(name: string, attributes: TelemetryAttributes = {}): void {
    assertMetricName(name);
    const key = metricKey(name, attributes);
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    this.logger.info('telemetry.counter', {
      metric: name,
      value: next,
      attributes,
    });
  }

  record(name: string, value: number, attributes: TelemetryAttributes = {}): void {
    assertMetricName(name);
    if (!Number.isFinite(value)) throw new Error(`INVALID_TELEMETRY_VALUE:${name}`);

    const key = metricKey(name, attributes);
    const current = this.observations.get(key);
    const next: TelemetryObservation = current
      ? {
          count: current.count + 1,
          sum: current.sum + value,
          min: Math.min(current.min, value),
          max: Math.max(current.max, value),
          last: value,
        }
      : { count: 1, sum: value, min: value, max: value, last: value };
    this.observations.set(key, next);
    this.logger.info('telemetry.observation', {
      metric: name,
      value,
      attributes,
      count: next.count,
    });
  }

  snapshot(): TelemetrySnapshot {
    return {
      counters: Object.fromEntries(
        [...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
      observations: Object.fromEntries(
        [...this.observations.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    for (const [key, value] of [...this.counters.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const parsed = parseMetricKey(key);
      lines.push(`${prometheusName(parsed.name)}${prometheusLabels(parsed.attributes)} ${value}`);
    }
    for (const [key, observation] of [...this.observations.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const parsed = parseMetricKey(key);
      const name = prometheusName(parsed.name);
      const labels = prometheusLabels(parsed.attributes);
      lines.push(`${name}_count${labels} ${observation.count}`);
      lines.push(`${name}_sum${labels} ${observation.sum}`);
      lines.push(`${name}_min${labels} ${observation.min}`);
      lines.push(`${name}_max${labels} ${observation.max}`);
      lines.push(`${name}_last${labels} ${observation.last}`);
    }
    return `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`;
  }
}

export class NoopTelemetry implements Telemetry {
  increment(name: string, attributes?: TelemetryAttributes): void {
    void name;
    void attributes;
  }

  record(name: string, value: number, attributes?: TelemetryAttributes): void {
    void name;
    void value;
    void attributes;
  }
}

function metricKey(name: string, attributes: TelemetryAttributes): string {
  const normalized = Object.entries(attributes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, String(value)] as const);
  return JSON.stringify([name, normalized]);
}

function parseMetricKey(key: string): { name: string; attributes: Record<string, string> } {
  const [name, entries] = JSON.parse(key) as [string, [string, string][]];
  return { name, attributes: Object.fromEntries(entries) };
}

function prometheusName(name: string): string {
  return `toca_${name.replace(/[^a-zA-Z0-9_:]/g, '_')}`;
}

function prometheusLabels(attributes: Readonly<Record<string, string>>): string {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return '';
  return `{${entries
    .map(([key, value]) => `${key.replace(/[^a-zA-Z0-9_]/g, '_')}="${escapeLabel(value)}"`)
    .join(',')}}`;
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function assertMetricName(name: string): void {
  if (!name.trim()) throw new Error('TELEMETRY_METRIC_NAME_REQUIRED');
}
