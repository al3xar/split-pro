import { SplitType } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { DEFAULT_CATEGORY } from '~/lib/category';
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

  /** Registers a payment from the net debtor that covers the chosen debts first. */
  settle: protectedProcedure
    .input(
      pairInput.extend({
        expenseIds: z.array(z.string().uuid()).min(1),
        expectedTotal: z.bigint().positive(),
        name: z.string().min(1).max(100),
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
        if (null === debts.debtorId || null === debts.creditorId) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Nothing to settle' });
        }
        const pending = new Map(
          debts.items
            .filter((i) => i.debtorId === debts.debtorId && 0n < i.remaining)
            .map((i) => [i.expenseId, i.remaining]),
        );
        if (!input.expenseIds.every((id) => pending.has(id))) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Debts changed' });
        }
        const total = input.expenseIds.reduce((sum, id) => sum + pending.get(id)!, 0n);
        if (total !== input.expectedTotal) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Debts changed' });
        }

        return tx.expense.create({
          data: {
            groupId: input.groupId,
            paidBy: debts.debtorId,
            addedBy: userId,
            name: input.name,
            category: DEFAULT_CATEGORY,
            amount: total,
            splitType: SplitType.SETTLEMENT,
            currency: input.currency,
            expenseParticipants: {
              create: [
                { userId: debts.debtorId, amount: total },
                { userId: debts.creditorId, amount: -total },
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
});
