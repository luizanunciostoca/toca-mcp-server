import type { EngagementIntent } from '../policy/engagement-policy.js';
import { resolveCurrentProgrammingKnowledge } from './current-programming.js';
import type {
  InstagramEngagementKnowledgeMatch,
  InstagramEngagementKnowledgeSource,
} from './knowledge.js';
import { enforceOfficialTicketInformation } from './ticket-information.js';

export interface TieredInstagramEngagementKnowledgeOptions {
  readonly faq: InstagramEngagementKnowledgeSource;
  readonly knowledgeBase?: InstagramEngagementKnowledgeSource;
  readonly now?: () => Date;
}

export class TieredInstagramEngagementKnowledgeSource implements InstagramEngagementKnowledgeSource {
  constructor(private readonly options: TieredInstagramEngagementKnowledgeOptions) {}

  async resolve(
    text: string,
    expectedIntent: EngagementIntent,
  ): Promise<InstagramEngagementKnowledgeMatch | null> {
    const faq = await this.options.faq.resolve(text, expectedIntent);
    if (faq) return enforceOfficialTicketInformation(faq);

    const currentProgramming = resolveCurrentProgrammingKnowledge(text, expectedIntent, {
      now: this.options.now?.() ?? new Date(),
    });
    if (currentProgramming) return currentProgramming;

    if (!this.options.knowledgeBase) return null;
    const knowledgeBase = await this.options.knowledgeBase.resolve(text, expectedIntent);
    return knowledgeBase ? enforceOfficialTicketInformation(knowledgeBase) : null;
  }
}
