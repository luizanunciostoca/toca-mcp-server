export interface TelemetryAttributes {
  readonly [key: string]: string | number | boolean;
}

export interface Telemetry {
  increment(name: string, attributes?: TelemetryAttributes): void;
  record(name: string, value: number, attributes?: TelemetryAttributes): void;
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
