export type EngagementChannel = 'COMMENT' | 'DIRECT';

export type EngagementAutonomy =
  'READ_ONLY' | 'SUGGEST_ONLY' | 'AUTO_REPLY_ALLOWED' | 'HUMAN_REVIEW_REQUIRED';

export type EngagementRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface InstagramComment {
  readonly id: string;
  readonly mediaId?: string;
  readonly fromId?: string;
  readonly username?: string;
  readonly text: string;
  readonly timestamp?: string;
}

export interface InstagramConversationMessage {
  readonly id: string;
  readonly conversationId?: string;
  readonly senderId?: string;
  readonly recipientId?: string;
  readonly text?: string;
  readonly timestamp?: string;
}

export interface CommentReplyInput {
  readonly commentId: string;
  readonly message: string;
}

export interface DirectReplyInput {
  readonly pageId: string;
  readonly instagramUserId: string;
  readonly recipientScopedId: string;
  readonly message: string;
}

export interface EngagementDecision {
  readonly channel: EngagementChannel;
  readonly risk: EngagementRisk;
  readonly autonomy: EngagementAutonomy;
  readonly reason: string;
  readonly requiresHumanReview: boolean;
}

export interface InstagramEngagementProvider {
  replyToComment(input: CommentReplyInput): Promise<{ readonly commentId: string }>;
  sendDirectReply(input: DirectReplyInput): Promise<{
    readonly recipientId: string;
    readonly messageId: string;
  }>;
}

export interface InstagramWebhookEvent {
  readonly eventId: string;
  readonly accountId: string;
  readonly channel: EngagementChannel;
  readonly senderId?: string;
  readonly commentId?: string;
  readonly messageId?: string;
  readonly mediaId?: string;
  readonly text?: string;
  readonly occurredAt?: string;
  readonly rawType: string;
}
