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
    const response = (await this.client.postJson(`${input.instagramUserId}/messages`, {
      recipient: { id: input.recipientScopedId },
      message: { text: input.message },
    })) as Record<string, unknown>;

    return {
      recipientId: requireString(response.recipient_id, 'recipient_id'),
      messageId: requireString(response.message_id, 'message_id'),
    };
  }
}
