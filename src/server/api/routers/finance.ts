import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { monthKey } from '~/lib/analytics';
import { financeEntryInputSchema, monthBounds, monthSchema, timeZoneSchema } from '~/lib/finance';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { db } from '~/server/db';

const assertOwnEntry = async (id: number, userId: number) => {
  const entry = await db.financeEntry.findUnique({ where: { id }, select: { userId: true } });
  if (!entry || entry.userId !== userId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Entry not found' });
  }
};

export const financeRouter = createTRPCRouter({
  getMonth: protectedProcedure
    .input(z.object({ month: monthSchema, timeZone: timeZoneSchema }))
    .query(async ({ ctx, input }) => {
      const entries = await db.financeEntry.findMany({
        where: { userId: ctx.session.user.id, date: monthBounds(input.month, input.month) },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      });
      return entries.filter((e) => monthKey(e.date, input.timeZone) === input.month);
    }),

  create: protectedProcedure
    .input(financeEntryInputSchema)
    .mutation(({ ctx, input }) =>
      db.financeEntry.create({ data: { ...input, userId: ctx.session.user.id } }),
    ),

  createMany: protectedProcedure
    .input(z.array(financeEntryInputSchema).min(1).max(100))
    .mutation(async ({ ctx, input }) => {
      const { count } = await db.financeEntry.createMany({
        data: input.map((entry) => ({ ...entry, userId: ctx.session.user.id })),
      });
      return { count };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int(), entry: financeEntryInputSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnEntry(input.id, ctx.session.user.id);
      return db.financeEntry.update({ where: { id: input.id }, data: input.entry });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnEntry(input.id, ctx.session.user.id);
      await db.financeEntry.delete({ where: { id: input.id } });
      return { id: input.id };
    }),
});
