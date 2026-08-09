export interface TelemetryAttributes {
  readonly [key: string]: string | number | boolean;
}

export interface Telemetry {
  increment(name: string, attributes?: TelemetryAttributes): void;
  record(name: string, value: number, attributes?: TelemetryAttributes): void;
}

export class NoopTelemetry implements Telemetry {
  increment(_name: string, _attributes?: TelemetryAttributes): void {}

  record(_name: string, _value: number, _attributes?: TelemetryAttributes): void {}
}
