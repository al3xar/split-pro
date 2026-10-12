import { z } from 'zod';

import { HOUSEHOLD_PERIODS, householdStats, periodRange } from '~/lib/household';
import { timeZoneSchema } from '~/lib/finance';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { db } from '~/server/db';

import { loadPairDebts } from '../services/debtService';

const userSelect = { id: true, name: true, email: true, image: true } as const;

export const householdRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ period: z.enum(HOUSEHOLD_PERIODS), timeZone: timeZoneSchema }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const group = await db.group.findFirst({
        where: {
          isHousehold: true,
          archivedAt: null,
          groupUsers: { some: { userId } },
        },
        orderBy: { householdSince: 'desc' },
        include: { groupUsers: { include: { user: { select: userSelect } } } },
      });
      if (!group) {
        return null;
      }

      const currency =
        group.defaultCurrency ?? ctx.session.user.defaultCurrency ?? ctx.session.user.currency;
      const members = group.groupUsers.map((gu) => gu.user);
      const range = periodRange(input.period, new Date(), input.timeZone);
      const baseWhere = { groupId: group.id, currency, deletedAt: null };
      const statsSelect = { amount: true, paidBy: true, category: true, splitType: true } as const;

      const [pairs, current, previous, recent] = await Promise.all([
        Promise.all(
          members
            .filter((m) => m.id !== userId)
            .map(async (friend) =>
              Object.assign({ friend }, await loadPairDebts(userId, friend.id, group.id, currency)),
            ),
        ),
        db.expense.findMany({
          where: { ...baseWhere, ...(range.from && { expenseDate: { gte: range.from } }) },
          select: statsSelect,
        }),
        range.previousFrom && range.previousTo
          ? db.expense.findMany({
              where: {
                ...baseWhere,
                expenseDate: { gte: range.previousFrom, lt: range.previousTo },
              },
              select: statsSelect,
            })
          : Promise.resolve(null),
        db.expense.findMany({
          where: baseWhere,
          orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
          take: 5,
          select: {
            id: true,
            name: true,
            amount: true,
            category: true,
            splitType: true,
            expenseDate: true,
            paidByUser: { select: userSelect },
          },
        }),
      ]);

      return {
        group: { id: group.id, name: group.name, currency, members },
        pairs,
        stats: householdStats(current),
        previousTotal: previous ? householdStats(previous).total : null,
        recent,
      };
    }),
});
