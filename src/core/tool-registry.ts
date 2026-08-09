export type RiskClass =
  'READ' | 'WRITE_REVERSIBLE' | 'WRITE_EXTERNAL' | 'FINANCIAL_IMPACT' | 'DESTRUCTIVE';

export type CapabilityStatus =
  | 'PLANNED'
  | 'IMPLEMENTED'
  | 'CONNECTED'
  | 'PRODUCTION_VALIDATED'
  | 'SUSPENDED'
  | 'DEPRECATED'
  | 'REMOVED';

export interface ToolDefinition {
  readonly name: string;
  readonly version: string;
  readonly provider: string;
  readonly riskClass: RiskClass;
  readonly requiredScopes: readonly string[];
  readonly capabilityStatus: CapabilityStatus;
  readonly sideEffects: boolean;
  readonly idempotent: boolean;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool already registered: ${definition.name}`);
    }
    this.tools.set(definition.name, definition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
