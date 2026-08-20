import type { Experiment, LearningEvaluation, Outcome } from './contracts.js';
import { evaluateExperiment } from './experimentation-engine.js';

export interface LearningEngineInput {
  readonly experiment: Experiment;
  readonly outcomes: readonly Outcome[];
  readonly now: string;
}

/**
 * R31 is intentionally recommendation-only. It never invokes a provider, scheduler,
 * payment path or paid-media mutation. Provider-backed actions remain behind the
 * existing Core authorization, policy, approval and idempotency boundaries.
 */
export class R31LearningEngine {
  evaluate(input: LearningEngineInput): LearningEvaluation {
    return evaluateExperiment(input);
  }
}
