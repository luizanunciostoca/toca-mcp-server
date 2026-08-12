export interface StructuredLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export class JsonConsoleLogger implements StructuredLogger {
  info(event: string, fields: Record<string, unknown> = {}): void {
    console.log(
      JSON.stringify({ severity: 'INFO', event, ...fields, timestamp: new Date().toISOString() }),
    );
  }

  error(event: string, fields: Record<string, unknown> = {}): void {
    console.error(
      JSON.stringify({ severity: 'ERROR', event, ...fields, timestamp: new Date().toISOString() }),
    );
  }
}
