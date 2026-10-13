import { type Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { timeZoneSchema } from '~/lib/finance';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { runAgent } from '~/server/assistant/agent';
import { type ChatMsg, type ToolCall, chatCompletion } from '~/server/assistant/llm';
import { maskSecret } from '~/server/assistant/config';
import {
  clearAssistantConfig,
  getAssistantConfig,
  saveAssistantConfig,
} from '~/server/assistant/configStore';
import { type AssistantContext, buildTools, systemPrompt } from '~/server/assistant/tools';
import { db } from '~/server/db';

const HISTORY_LIMIT = 40;

export interface ProposalState {
  prefill: Record<string, unknown>;
  status: 'pending' | 'saved' | 'cancelled';
  expenseId?: string;
}

const enabledConfig = async () => {
  const config = await getAssistantConfig();
  if (!config.enabled) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'ASSISTANT_DISABLED' });
  }
  return config;
};

const urlSchema = z
  .string()
  .trim()
  .url()
  .refine((url) => /^https?:\/\//.test(url), 'Only http(s) URLs');

/** GET {base}/models with the key: proves the URL, the key and that the model exists. */
const testConnection = async (
  baseUrl: string,
  apiKey: string | undefined,
  model: string | undefined,
) => {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { ok: false as const, error: `HTTP_${response.status}`, models: [] as string[] };
    }
    const json = (await response.json()) as { data?: { id?: string }[] };
    const models = (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    return {
      ok: true as const,
      models: models.slice(0, 50),
      modelFound: model ? models.includes(model) : null,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error && 'TimeoutError' === error.name ? 'TIMEOUT' : 'UNREACHABLE',
      models: [] as string[],
    };
  }
};

const ownConversation = async (userId: number, id: string) => {
  const conversation = await db.chatConversation.findFirst({ where: { id, userId } });
  if (!conversation) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
  }
  return conversation;
};

const loadContext = async (
  userId: number,
  timeZone: string,
  fallbackCurrency: string,
): Promise<AssistantContext> => {
  const group = await db.group.findFirst({
    where: { isHousehold: true, archivedAt: null, groupUsers: { some: { userId } } },
    orderBy: { householdSince: 'desc' },
    include: {
      groupUsers: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  const me = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  const members = group
    ? group.groupUsers.map((gu) => ({
        id: gu.user.id,
        name: gu.user.name ?? gu.user.email ?? `#${gu.user.id}`,
      }))
    : [{ id: userId, name: me?.name ?? me?.email ?? 'me' }];
  return {
    userId,
    timeZone,
    currency: group?.defaultCurrency ?? fallbackCurrency,
    group: group ? { id: group.id, name: group.name } : null,
    members,
  };
};

const toChatMsg = (row: {
  role: string;
  content: string | null;
  toolCalls: Prisma.JsonValue;
  toolCallId: string | null;
}): ChatMsg => ({
  role: row.role as ChatMsg['role'],
  content: row.content,
  ...(row.toolCalls ? { tool_calls: row.toolCalls as unknown as ToolCall[] } : {}),
  ...(row.toolCallId ? { tool_call_id: row.toolCallId } : {}),
});

export const assistantRouter = createTRPCRouter({
  enabled: protectedProcedure.query(async () => (await getAssistantConfig()).enabled),

  /** Settings for the UI; the API key never leaves the server, only a hint. */
  settings: protectedProcedure.query(async () => {
    const config = await getAssistantConfig();
    return {
      baseUrl: config.baseUrl ?? '',
      model: config.model ?? '',
      maxSteps: config.maxSteps,
      hasApiKey: Boolean(config.apiKey),
      apiKeyHint: config.apiKey ? maskSecret(config.apiKey) : null,
      source: config.source,
      enabled: config.enabled,
    };
  }),

  saveSettings: protectedProcedure
    .input(
      z.object({
        baseUrl: urlSchema.or(z.literal('')),
        model: z.string().trim().max(200),
        /** Undefined = keep, null = remove, string = replace */
        apiKey: z.string().max(500).nullable().optional(),
        maxSteps: z.number().int().min(1).max(10),
      }),
    )
    .mutation(async ({ input }) => {
      await saveAssistantConfig({
        baseUrl: input.baseUrl || null,
        model: input.model || null,
        apiKey: input.apiKey,
        maxSteps: input.maxSteps,
      });
      return { saved: true };
    }),

  resetSettings: protectedProcedure.mutation(async () => {
    await clearAssistantConfig();
    return { reset: true };
  }),

  /** Tries the given URL/model; uses the stored key unless a new one is typed. */
  testSettings: protectedProcedure
    .input(
      z.object({
        baseUrl: urlSchema,
        model: z.string().trim().max(200),
        apiKey: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const stored = await getAssistantConfig();
      return testConnection(input.baseUrl, input.apiKey || stored.apiKey, input.model || undefined);
    }),

  conversations: protectedProcedure.query(({ ctx }) =>
    db.chatConversation.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true },
      take: 50,
    }),
  ),

  /** Messages to display: user/assistant text and expense proposals. */
  messages: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await ownConversation(ctx.session.user.id, input.conversationId);
      const rows = await db.chatMessage.findMany({
        where: { conversationId: input.conversationId },
        orderBy: { id: 'asc' },
      });
      return rows
        .filter((r) => r.proposal || ('tool' !== r.role && r.content))
        .map((r) => ({
          id: r.id,
          role: r.role,
          content: r.proposal ? null : r.content,
          proposal: r.proposal as unknown as ProposalState | null,
          createdAt: r.createdAt,
        }));
    }),

  send: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid().optional(),
        text: z.string().trim().min(1).max(2000),
        timeZone: timeZoneSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const assistantConfig = await enabledConfig();
      const userId = ctx.session.user.id;
      const conversation = input.conversationId
        ? await ownConversation(userId, input.conversationId)
        : await db.chatConversation.create({ data: { userId, title: input.text.slice(0, 60) } });

      await db.chatMessage.create({
        data: { conversationId: conversation.id, role: 'user', content: input.text },
      });
      const history = (
        await db.chatMessage.findMany({
          where: { conversationId: conversation.id },
          orderBy: { id: 'desc' },
          take: HISTORY_LIMIT,
        })
      )
        .reverse()
        .map(toChatMsg);
      // Never start the history with orphan tool results.
      while (history[0] && 'user' !== history[0].role) {
        history.shift();
      }

      const context = await loadContext(
        userId,
        input.timeZone,
        ctx.session.user.defaultCurrency ?? ctx.session.user.currency,
      );
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: input.timeZone }).format(
        new Date(),
      );
      const config = {
        baseUrl: assistantConfig.baseUrl!,
        apiKey: assistantConfig.apiKey,
        model: assistantConfig.model!,
      };

      let result: Awaited<ReturnType<typeof runAgent>>;
      try {
        result = await runAgent({
          messages: [{ role: 'system', content: systemPrompt(context, today) }, ...history],
          tools: buildTools(context),
          complete: (messages, tools) => chatCompletion(config, messages, tools),
          maxSteps: assistantConfig.maxSteps,
        });
      } catch (error) {
        console.error('Assistant LLM call failed', error);
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'LLM_UNAVAILABLE' });
      }

      const proposals = new Map(result.proposals.map((p) => [p.toolCallId, p.prefill]));
      for (const message of result.messages) {
        const prefill = message.tool_call_id ? proposals.get(message.tool_call_id) : undefined;
        await db.chatMessage.create({
          data: {
            conversationId: conversation.id,
            role: message.role,
            content: message.content,
            toolCalls: (message.tool_calls as unknown as Prisma.InputJsonValue) ?? undefined,
            toolCallId: message.tool_call_id,
            proposal: prefill
              ? ({ prefill, status: 'pending' } as unknown as Prisma.InputJsonValue)
              : undefined,
          },
        });
      }
      if (result.stoppedEarly) {
        await db.chatMessage.create({
          data: { conversationId: conversation.id, role: 'assistant', content: '…' },
        });
      }
      await db.chatConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });
      return { conversationId: conversation.id };
    }),

  /** Records what the user did with a proposal so the model knows on the next turn. */
  proposalResult: protectedProcedure
    .input(
      z.object({
        messageId: z.number().int(),
        saved: z.boolean(),
        expenseId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const message = await db.chatMessage.findFirst({
        where: { id: input.messageId, conversation: { userId: ctx.session.user.id } },
      });
      if (!message?.proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' });
      }
      const proposal = message.proposal as unknown as ProposalState;
      const status = input.saved ? 'saved' : 'cancelled';
      await db.chatMessage.update({
        where: { id: message.id },
        data: {
          proposal: {
            ...proposal,
            status,
            expenseId: input.expenseId,
          } as unknown as Prisma.InputJsonValue,
          content: JSON.stringify(
            input.saved
              ? { status: 'The user saved the expense', expenseId: input.expenseId }
              : { status: 'The user cancelled; nothing was saved' },
          ),
        },
      });
      return { status };
    }),

  delete: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ownConversation(ctx.session.user.id, input.conversationId);
      await db.chatConversation.delete({ where: { id: input.conversationId } });
      return { id: input.conversationId };
    }),
});
