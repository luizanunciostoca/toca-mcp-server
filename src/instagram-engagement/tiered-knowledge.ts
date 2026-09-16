import type { EngagementIntent } from '../policy/engagement-policy.js';
import type {
  InstagramEngagementKnowledgeMatch,
  InstagramEngagementKnowledgeSource,
} from './knowledge.js';
import { enforceOfficialTicketInformation } from './ticket-information.js';

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
    if (faq) return enforceOfficialTicketInformation(faq);
    if (!this.options.knowledgeBase) return null;
    const knowledgeBase = await this.options.knowledgeBase.resolve(text, expectedIntent);
    return knowledgeBase ? enforceOfficialTicketInformation(knowledgeBase) : null;
  }
}
