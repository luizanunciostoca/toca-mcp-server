import type { EngagementIntent } from '../policy/engagement-policy.js';
import { resolveCurrentProgrammingKnowledge } from './current-programming.js';
import { resolveGroupedKnowledge, splitMessageSegments } from './grouped-knowledge.js';
import type {
  InstagramEngagementKnowledgeMatch,
  InstagramEngagementKnowledgeSource,
} from './knowledge.js';

export interface MultiIntentInstagramEngagementKnowledgeOptions {
  readonly now?: () => Date;
  readonly groundedFallback?: InstagramEngagementKnowledgeSource;
}

export class MultiIntentInstagramEngagementKnowledgeSource implements InstagramEngagementKnowledgeSource {
  private readonly now: () => Date;
  private readonly groundedFallback: InstagramEngagementKnowledgeSource | undefined;

  constructor(
    private readonly delegate: InstagramEngagementKnowledgeSource,
    options: MultiIntentInstagramEngagementKnowledgeOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.groundedFallback = options.groundedFallback;
  }

  async resolve(
    text: string,
    expectedIntent: EngagementIntent,
  ): Promise<InstagramEngagementKnowledgeMatch | null> {
    const segments = splitMessageSegments(text, estimatedMessageCount(text));
    if (segments.length <= 1) {
      return this.resolveSingle(text, expectedIntent);
    }

    const resolution = await resolveGroupedKnowledge({
      groupedText: text,
      messageCount: segments.length,
      knowledge: { resolve: (segment, intent) => this.resolveSingle(segment, intent) },
    });
    return resolution.autoReplySafe ? resolution.knowledge : null;
  }

  private async resolveSingle(
    text: string,
    expectedIntent: EngagementIntent,
  ): Promise<InstagramEngagementKnowledgeMatch | null> {
    const deterministic = await this.delegate.resolve(text, expectedIntent);
    if (deterministic) return deterministic;
    const currentProgramming = resolveCurrentProgrammingKnowledge(text, expectedIntent, {
      now: this.now(),
    });
    if (currentProgramming) return currentProgramming;
    return this.groundedFallback?.resolve(text, expectedIntent) ?? null;
  }
}

function estimatedMessageCount(text: string): number {
  const nonEmptyLines = text
    .split(/\r?\n+/g)
    .map((value) => value.trim())
    .filter(Boolean).length;
  return Math.max(1, nonEmptyLines);
}
