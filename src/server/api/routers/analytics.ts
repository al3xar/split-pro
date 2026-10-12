import { SplitType } from '@prisma/client';
import { z } from 'zod';

import { buildAnalytics, monthKey, monthRange } from '~/lib/analytics';
import { monthBounds, monthSchema, timeZoneSchema } from '~/lib/finance';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { db } from '~/server/db';

const EXCLUDED_SPLIT_TYPES = [SplitType.SETTLEMENT, SplitType.CURRENCY_CONVERSION];

export const analyticsRouter = createTRPCRouter({
  getOverview: protectedProcedure
    .input(
      z.object({
        month: monthSchema,
        months: z.number().int().min(1).max(24).default(12),
        currency: z.string().length(3).optional(),
        timeZone: timeZoneSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const months = monthRange(input.month, input.months);
      const dateRange = monthBounds(months[0]!, months.at(-1)!);

      const expenseWhere = {
        deletedAt: null,
        splitType: { notIn: EXCLUDED_SPLIT_TYPES },
        OR: [{ paidBy: userId }, { expenseParticipants: { some: { userId } } }],
      };

      const [expenseCurrencies, entryCurrencies, user] = await Promise.all([
        db.expense.groupBy({ by: ['currency'], where: expenseWhere, _count: true }),
        db.financeEntry.groupBy({ by: ['currency'], where: { userId }, _count: true }),
        db.user.findUnique({
          where: { id: userId },
          select: { currency: true, defaultCurrency: true },
        }),
      ]);

      const usage = new Map<string, number>();
      [...expenseCurrencies, ...entryCurrencies].forEach(({ currency, _count }) =>
        usage.set(currency, (usage.get(currency) ?? 0) + _count),
      );
      const currencies = [...usage.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);

      const preferred = user?.defaultCurrency ?? user?.currency;
      const currency =
        input.currency ??
        (preferred && currencies.includes(preferred) ? preferred : currencies[0]) ??
        preferred ??
        'EUR';

      const [expenses, entries] = await Promise.all([
        db.expense.findMany({
          where: { ...expenseWhere, currency, expenseDate: dateRange },
          select: {
            amount: true,
            paidBy: true,
            category: true,
            expenseDate: true,
            expenseParticipants: { where: { userId }, select: { amount: true } },
          },
        }),
        db.financeEntry.findMany({
          where: { userId, currency, date: dateRange },
          select: { type: true, amount: true, category: true, date: true },
        }),
      ]);

      const result = buildAnalytics({
        userId,
        timeZone: input.timeZone,
        months,
        expenses: expenses.map((e) => ({
          amount: e.amount,
          paidBy: e.paidBy,
          category: e.category,
          expenseDate: e.expenseDate,
          myParticipantAmount: e.expenseParticipants[0]?.amount ?? null,
        })),
        entries,
      });

      return {
        ...result,
        currency,
        currencies: currencies.includes(currency) ? currencies : [currency, ...currencies],
        hasFinanceEntries: entries.some((e) => monthKey(e.date, input.timeZone) === input.month),
      };
    }),
});
