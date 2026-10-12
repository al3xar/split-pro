import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import {
  type ParsedTricount,
  buildTricountImport,
  parseRegistry,
  parseTricountKey,
  tricountTransactionId,
} from '~/lib/tricount';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { db } from '~/server/db';
import { fetchTricountRegistry } from '~/server/tricount/client';

const loadTricount = async (link: string): Promise<ParsedTricount> => {
  const key = parseTricountKey(link);
  if (!key) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_LINK' });
  }
  let json: unknown;
  try {
    json = await fetchTricountRegistry(key);
  } catch (error) {
    console.error('Tricount fetch failed', error);
    throw new TRPCError({ code: 'BAD_GATEWAY', message: 'TRICOUNT_UNAVAILABLE' });
  }
  if (0 === ((json as { Response?: unknown[] })?.Response?.length ?? 0)) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'TRICOUNT_NOT_FOUND' });
  }
  try {
    return parseRegistry(json);
  } catch (error) {
    console.error('Tricount response not understood', error);
    throw new TRPCError({ code: 'BAD_GATEWAY', message: 'TRICOUNT_FORMAT_CHANGED' });
  }
};

/** Expenses already imported from this Tricount into groups the user belongs to. */
const findImported = async (userId: number, parsed: ParsedTricount) => {
  const ids = parsed.entries.map((e) => tricountTransactionId(e.uuid));
  return db.expense.findMany({
    where: { transactionId: { in: ids }, group: { groupUsers: { some: { userId } } } },
    select: { transactionId: true, groupId: true, group: { select: { name: true } } },
  });
};

export const tricountRouter = createTRPCRouter({
  preview: protectedProcedure
    .input(z.object({ link: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const parsed = await loadTricount(input.link);
      const imported = await findImported(ctx.session.user.id, parsed);
      const dates = parsed.entries.map((e) => e.date.getTime());
      const count = (type: string) => parsed.entries.filter((e) => e.type === type).length;
      return {
        title: parsed.title,
        currency: parsed.currency,
        members: parsed.members,
        counts: { normal: count('NORMAL'), balance: count('BALANCE'), income: count('INCOME') },
        from: dates.length ? new Date(Math.min(...dates)) : null,
        to: dates.length ? new Date(Math.max(...dates)) : null,
        total: parsed.entries
          .filter((e) => 'NORMAL' === e.type)
          .reduce((sum, e) => sum + e.amount, 0n),
        alreadyImported: imported.length,
        existingGroup: imported[0]?.group
          ? { id: imported[0].groupId!, name: imported[0].group.name }
          : null,
      };
    }),

  import: protectedProcedure
    .input(
      z.object({
        link: z.string().min(1).max(200),
        members: z
          .array(
            z.object({
              name: z.string(),
              isMe: z.boolean().default(false),
              email: z.string().email().optional(),
            }),
          )
          .min(1),
        groupName: z.string().min(1).max(100),
        household: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const parsed = await loadTricount(input.link);

      const mapping = new Map(input.members.map((m) => [m.name, m]));
      if (!parsed.members.every((name) => mapping.has(name))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'UNMAPPED_MEMBERS' });
      }
      if (1 !== input.members.filter((m) => m.isMe).length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'ONE_MEMBER_MUST_BE_YOU' });
      }
      if (input.members.some((m) => !m.isMe && !m.email)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'EMAIL_REQUIRED' });
      }

      const imported = await findImported(userId, parsed);
      const existingIds = new Set(imported.map((e) => e.transactionId!));
      const existingGroupId = imported[0]?.groupId ?? null;

      return db.$transaction(
        async (tx) => {
          const memberIds: Record<string, number> = {};
          for (const member of input.members) {
            if (member.isMe) {
              memberIds[member.name] = userId;
              // oxlint-disable-next-line no-continue
              continue;
            }
            const email = member.email!.toLowerCase();
            const user =
              (await tx.user.findUnique({ where: { email } })) ??
              (await tx.user.create({ data: { email, name: member.name } }));
            memberIds[member.name] = user.id;
          }
          const userIds = [...new Set(Object.values(memberIds))];

          const groupId =
            existingGroupId ??
            (
              await tx.group.create({
                data: {
                  name: input.groupName,
                  publicId: nanoid(),
                  userId,
                  defaultCurrency: parsed.currency,
                  ...(input.household && { isHousehold: true, householdSince: new Date() }),
                },
              })
            ).id;
          await tx.groupUser.createMany({
            data: userIds.map((id) => ({ groupId, userId: id })),
            skipDuplicates: true,
          });

          const { expenses, skipped } = buildTricountImport(parsed, memberIds, existingIds);
          for (const expense of expenses) {
            const { participants, ...data } = expense;
            await tx.expense.create({
              data: {
                ...data,
                groupId,
                addedBy: userId,
                expenseParticipants: { create: participants },
              },
            });
          }

          return { groupId, created: expenses.length, skipped };
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    }),
});
