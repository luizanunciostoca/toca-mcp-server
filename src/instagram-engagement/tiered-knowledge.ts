import type { EngagementIntent } from '../policy/engagement-policy.js';
import type {
  InstagramEngagementKnowledgeMatch,
  InstagramEngagementKnowledgeSource,
} from './knowledge.js';

export interface TieredInstagramEngagementKnowledgeOptions {
  readonly faq: InstagramEngagementKnowledgeSource;
  readonly knowledgeBase?: InstagramEngagementKnowledgeSource;
}

export class TieredInstagramEngagementKnowledgeSource implements InstagramEngagementKnowledgeSource {
  constructor(private readonly options: TieredInstagramEngagementKnowledgeOptions) {}

  async resolve(
    text: string,
    expectedIntent: EngagementIntent,
  ): Promise<InstagramEngagementKnowledgeMatch | null> {
    const faq = await this.options.faq.resolve(text, expectedIntent);
    if (faq) return faq;
    if (!this.options.knowledgeBase) return null;
    return this.options.knowledgeBase.resolve(text, expectedIntent);
  }
}
