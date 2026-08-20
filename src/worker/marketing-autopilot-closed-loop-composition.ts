import type pg from 'pg';
import type { CoreCapabilityGateway } from '../orchestrator/contracts.js';
import { PostgresWorkflowStore } from '../persistence/postgres-workflow-store.js';
import {
  MarketingAutopilotClosedLoopRunner,
  type MarketingAutopilotClosedLoopAdapters,
} from '../learning/marketing-autopilot-closed-loop.js';

export interface MarketingAutopilotClosedLoopCompositionOptions {
  readonly pool: pg.Pool;
  /** Existing Core gateway. All schedule/publish side effects return through this boundary. */
  readonly core: CoreCapabilityGateway;
  /** Adapters over the already-existing Creative Truth, Asset, Measurement, Attribution and R31 engines. */
  readonly adapters: MarketingAutopilotClosedLoopAdapters;
}

export function createMarketingAutopilotClosedLoopRunner(
  options: MarketingAutopilotClosedLoopCompositionOptions,
): MarketingAutopilotClosedLoopRunner {
  return new MarketingAutopilotClosedLoopRunner({
    workflowStore: new PostgresWorkflowStore(options.pool),
    core: options.core,
    adapters: options.adapters,
  });
}
