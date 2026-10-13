import { SplitType } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { DEFAULT_CATEGORY } from '~/lib/category';
import { isFixedDebt } from '~/lib/debts';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { db } from '~/server/db';

import { loadPairDebts } from '../services/debtService';
import { sendExpensePushNotification } from '../services/notificationService';

const pairInput = z.object({
  friendId: z.number().int(),
  groupId: z.number().int().nullable(),
  currency: z.string().length(3),
});

const assertGroupMembers = async (groupId: number | null, userIds: number[]) => {
  if (null === groupId) {
    return;
  }
  const members = await db.groupUser.count({ where: { groupId, userId: { in: userIds } } });
  if (members !== userIds.length) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a group member' });
  }
};

export const debtsRouter = createTRPCRouter({
  getPair: protectedProcedure.input(pairInput).query(async ({ ctx, input }) => {
    await assertGroupMembers(input.groupId, [ctx.session.user.id, input.friendId]);
    return loadPairDebts(ctx.session.user.id, input.friendId, input.groupId, input.currency);
  }),

  /**
   * Registers a payment that covers the chosen debts. They must all be owed by the same person,
   * who is the payer; either member can register it.
   */
  settle: protectedProcedure
    .input(
      pairInput.extend({
        expenseIds: z.array(z.string().uuid()).min(1),
        expectedTotal: z.bigint().positive(),
        name: z.string().trim().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await assertGroupMembers(input.groupId, [userId, input.friendId]);
      const [low, high] = [userId, input.friendId].sort((a, b) => a - b);
      const lockKey = `debts:${low}:${high}:${input.groupId ?? 'none'}:${input.currency}`;

      const settlement = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        const debts = await loadPairDebts(
          userId,
          input.friendId,
          input.groupId,
          input.currency,
          tx,
        );
        const pending = new Map(
          debts.items.filter((i) => 0n < i.remaining).map((i) => [i.expenseId, i]),
        );
        const chosen = input.expenseIds.map((id) => pending.get(id));
        if (chosen.some((i) => undefined === i)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Debts changed' });
        }
        const debtorIds = new Set(chosen.map((i) => i!.debtorId));
        if (1 !== debtorIds.size) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Debts of different debtors' });
        }
        const debtorId = chosen[0]!.debtorId;
        const creditorId = chosen[0]!.creditorId;
        const total = chosen.reduce((sum, i) => sum + i!.remaining, 0n);
        if (total !== input.expectedTotal) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Debts changed' });
        }

        return tx.expense.create({
          data: {
            groupId: input.groupId,
            paidBy: debtorId,
            addedBy: userId,
            name: input.name,
            category: DEFAULT_CATEGORY,
            amount: total,
            splitType: SplitType.SETTLEMENT,
            currency: input.currency,
            expenseParticipants: {
              create: [
                { userId: debtorId, amount: total },
                { userId: creditorId, amount: -total },
              ],
            },
            settlementTargets: {
              create: input.expenseIds.map((expenseId, order) => ({ expenseId, order })),
            },
          },
          select: { id: true },
        });
      });

      sendExpensePushNotification(settlement.id).catch(console.error);
      return { settlementId: settlement.id };
    }),

  /** Takes an imported fixed expense out of the history allocation, or puts it back. */
  reopen: protectedProcedure
    .input(z.object({ expenseId: z.string().uuid(), reopened: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const expense = await db.expense.findFirst({
        where: {
          id: input.expenseId,
          deletedAt: null,
          transactionId: { startsWith: 'tricount:' },
          OR: [
            { group: { groupUsers: { some: { userId: ctx.session.user.id } } } },
            { expenseParticipants: { some: { userId: ctx.session.user.id } } },
          ],
        },
        select: { id: true, category: true, recurrenceId: true },
      });
      if (!expense || !isFixedDebt(expense.category, null !== expense.recurrenceId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Imported fixed expense not found' });
      }
      await db.expense.update({
        where: { id: expense.id },
        data: { debtReopenedAt: input.reopened ? new Date() : null },
      });
      return { reopened: input.reopened };
    }),
});
