import * as z from 'zod/v4';

export interface InstagramMessagingMetaClient {
  get(path: string, query?: Readonly<Record<string, string>>): Promise<unknown>;
  getWithAccessToken(
    path: string,
    query: Readonly<Record<string, string>>,
    accessToken: string,
  ): Promise<unknown>;
}

const pagingSchema = z
  .object({
    cursors: z
      .object({
        before: z.string().optional(),
        after: z.string().optional(),
      })
      .optional(),
    next: z.string().url().optional(),
    previous: z.string().url().optional(),
  })
  .optional();

const linkedInstagramSchema = z.object({ id: z.string().min(1) });
const pageSchema = z.object({
  id: z.string().min(1),
  access_token: z.string().min(1),
  tasks: z.array(z.string()).default([]),
  instagram_business_account: linkedInstagramSchema.optional(),
});
const pagesResponseSchema = z.object({ data: z.array(pageSchema) });
const profileSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
});

const conversationSchema = z.object({
  id: z.string().min(1),
  updated_time: z.string().optional(),
});
const conversationsResponseSchema = z.object({
  data: z.array(conversationSchema),
  paging: pagingSchema,
});

const participantSchema = z.object({
  id: z.string().optional(),
  username: z.string().optional(),
});
const messageSchema = z.object({
  id: z.string().min(1),
  created_time: z.string().optional(),
  from: participantSchema.optional(),
  to: z.object({ data: z.array(participantSchema) }).optional(),
  message: z.string().optional(),
  is_unsupported: z.boolean().optional(),
});
const messagesResponseSchema = z.object({
  messages: z.object({
    data: z.array(messageSchema),
    paging: pagingSchema,
  }),
});

export interface InstagramConversationListInput {
  readonly limit: number;
  readonly after?: string | undefined;
}

export interface InstagramConversationListItem {
  readonly conversationId: string;
  readonly updatedTime?: string | undefined;
}

export interface InstagramConversationListResult {
  readonly conversations: readonly InstagramConversationListItem[];
  readonly nextAfter?: string | undefined;
}

export interface InstagramMessageListInput {
  readonly conversationId: string;
  readonly limit: number;
}

export type InstagramMessageDirection = 'INBOUND' | 'OUTBOUND' | 'UNKNOWN';

export interface InstagramMessageReadItem {
  readonly messageId: string;
  readonly createdTime?: string | undefined;
  readonly direction: InstagramMessageDirection;
  readonly text?: string | undefined;
  readonly unsupported: boolean;
}

export interface InstagramMessageListResult {
  readonly messages: readonly InstagramMessageReadItem[];
  readonly providerHasMore: boolean;
  readonly providerMessageDetailLimit: 20;
}

interface PageBinding {
  readonly pageId: string;
  readonly pageAccessToken: string;
  readonly instagramUsername: string;
}

export class InstagramMessagingReadProvider {
  private pageBindingPromise: Promise<PageBinding> | undefined;

  constructor(
    private readonly client: InstagramMessagingMetaClient,
    private readonly instagramBusinessAccountId: string,
  ) {}

  async listConversations(
    input: InstagramConversationListInput,
  ): Promise<InstagramConversationListResult> {
    const binding = await this.pageBinding();
    const parsed = conversationsResponseSchema.safeParse(
      await this.client.getWithAccessToken(
        `${binding.pageId}/conversations`,
        {
          platform: 'instagram',
          fields: 'id,updated_time',
          limit: String(input.limit),
          ...(input.after ? { after: input.after } : {}),
        },
        binding.pageAccessToken,
      ),
    );
    if (!parsed.success) throw new Error('INSTAGRAM_MESSAGING_CONVERSATIONS_RESPONSE_INVALID');

    return {
      conversations: parsed.data.data.map((conversation) => ({
        conversationId: conversation.id,
        ...(conversation.updated_time ? { updatedTime: conversation.updated_time } : {}),
      })),
      ...(parsed.data.paging?.cursors?.after
        ? { nextAfter: parsed.data.paging.cursors.after }
        : {}),
    };
  }

  async listMessages(input: InstagramMessageListInput): Promise<InstagramMessageListResult> {
    const binding = await this.pageBinding();
    const boundedLimit = Math.min(input.limit, 20);
    const fields = `messages.limit(${boundedLimit}){id,created_time,from,to,message,is_unsupported}`;
    const parsed = messagesResponseSchema.safeParse(
      await this.client.getWithAccessToken(
        input.conversationId,
        { fields },
        binding.pageAccessToken,
      ),
    );
    if (!parsed.success) throw new Error('INSTAGRAM_MESSAGING_MESSAGES_RESPONSE_INVALID');

    const providerHasMore = Boolean(
      parsed.data.messages.paging?.next || parsed.data.messages.paging?.cursors?.after,
    );
    return {
      messages: parsed.data.messages.data.map((message) => ({
        messageId: message.id,
        ...(message.created_time ? { createdTime: message.created_time } : {}),
        direction: directionFor(message, binding, this.instagramBusinessAccountId),
        ...(message.message ? { text: message.message } : {}),
        unsupported: message.is_unsupported ?? false,
      })),
      providerHasMore,
      providerMessageDetailLimit: 20,
    };
  }

  private pageBinding(): Promise<PageBinding> {
    if (!this.pageBindingPromise) this.pageBindingPromise = this.resolvePageBinding();
    return this.pageBindingPromise;
  }

  private async resolvePageBinding(): Promise<PageBinding> {
    const profile = profileSchema.safeParse(
      await this.client.get(this.instagramBusinessAccountId, { fields: 'id,username' }),
    );
    if (!profile.success || profile.data.id !== this.instagramBusinessAccountId) {
      throw new Error('INSTAGRAM_MESSAGING_PROFILE_RESPONSE_INVALID');
    }

    const pages = pagesResponseSchema.safeParse(
      await this.client.get('me/accounts', {
        fields: 'id,access_token,tasks,instagram_business_account',
        limit: '100',
      }),
    );
    if (!pages.success) throw new Error('INSTAGRAM_MESSAGING_PAGES_RESPONSE_INVALID');

    const matches = pages.data.data.filter(
      (page) => page.instagram_business_account?.id === this.instagramBusinessAccountId,
    );
    if (matches.length !== 1) throw new Error(`INSTAGRAM_MESSAGING_PAGE_MATCH_COUNT:${matches.length}`);

    const page = matches[0];
    if (!page.tasks.includes('MESSAGING')) throw new Error('INSTAGRAM_PAGE_MESSAGING_TASK_MISSING');
    return {
      pageId: page.id,
      pageAccessToken: page.access_token,
      instagramUsername: profile.data.username,
    };
  }
}

function directionFor(
  message: z.infer<typeof messageSchema>,
  binding: PageBinding,
  instagramBusinessAccountId: string,
): InstagramMessageDirection {
  const from = message.from;
  if (!from) return 'UNKNOWN';
  if (
    from.id === instagramBusinessAccountId ||
    from.id === binding.pageId ||
    from.username === binding.instagramUsername
  ) {
    return 'OUTBOUND';
  }
  return 'INBOUND';
}
