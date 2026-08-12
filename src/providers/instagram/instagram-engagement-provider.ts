import type { MetaApiClient } from '../meta/meta-api-client.js';
import type {
  CommentReplyInput,
  DirectReplyInput,
  InstagramEngagementProvider,
} from './instagram-engagement-contracts.js';

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`INSTAGRAM_INVALID_RESPONSE:${field}`);
  }
  return value;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`INSTAGRAM_INVALID_RESPONSE:${field}`);
  }
  return value as Record<string, unknown>;
}

export class InstagramGraphEngagementProvider implements InstagramEngagementProvider {
  constructor(private readonly client: MetaApiClient) {}

  async replyToComment(input: CommentReplyInput): Promise<{ readonly commentId: string }> {
    const response = (await this.client.post(`${input.commentId}/replies`, {
      message: input.message,
    })) as Record<string, unknown>;

    return { commentId: requireString(response.id, 'id') };
  }

  async sendDirectReply(input: DirectReplyInput): Promise<{
    readonly recipientId: string;
    readonly messageId: string;
  }> {
    const accountsResponse = requireObject(
      await this.client.get('me/accounts', {
        fields: 'id,access_token,tasks,instagram_business_account',
        limit: '100',
      }),
      'accounts',
    );
    if (!Array.isArray(accountsResponse.data)) {
      throw new Error('INSTAGRAM_INVALID_RESPONSE:accounts.data');
    }

    const pageMatches = accountsResponse.data.filter((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
      return (candidate as Record<string, unknown>).id === input.pageId;
    });
    if (pageMatches.length !== 1) {
      throw new Error(`INSTAGRAM_PAGE_MATCH_COUNT:${pageMatches.length}`);
    }

    const page = requireObject(pageMatches[0], 'page');
    const tasks = Array.isArray(page.tasks) ? page.tasks : [];
    if (!tasks.includes('MESSAGING')) {
      throw new Error('INSTAGRAM_PAGE_MESSAGING_TASK_MISSING');
    }

    const linkedInstagram = requireObject(page.instagram_business_account, 'instagram_business_account');
    if (linkedInstagram.id !== input.instagramUserId) {
      throw new Error('INSTAGRAM_LINKED_ACCOUNT_MISMATCH');
    }

    const pageAccessToken = requireString(page.access_token, 'page.access_token');
    const response = requireObject(
      await this.client.postJsonWithAccessToken(
        `${input.pageId}/messages`,
        {
          recipient: { id: input.recipientScopedId },
          messaging_type: 'RESPONSE',
          message: { text: input.message },
        },
        pageAccessToken,
      ),
      'send',
    );

    const recipientId = requireString(response.recipient_id, 'recipient_id');
    if (recipientId !== input.recipientScopedId) {
      throw new Error('INSTAGRAM_INVALID_RESPONSE:recipient_id_mismatch');
    }

    return {
      recipientId,
      messageId: requireString(response.message_id, 'message_id'),
    };
  }
}
