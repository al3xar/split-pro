import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { monthKey } from '~/lib/analytics';
import {
  financeEntryInputSchema,
  financeRecurrenceInputSchema,
  monthBounds,
  monthSchema,
  timeZoneSchema,
} from '~/lib/finance';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { db } from '~/server/db';

import { materializeRecurrences } from '../services/financeService';

const assertOwnEntry = async (id: number, userId: number) => {
  const entry = await db.financeEntry.findUnique({ where: { id }, select: { userId: true } });
  if (!entry || entry.userId !== userId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Entry not found' });
  }
};

const assertOwnRecurrence = async (id: number, userId: number) => {
  const recurrence = await db.financeRecurrence.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!recurrence || recurrence.userId !== userId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Recurrence not found' });
  }
};

export const financeRouter = createTRPCRouter({
  getMonth: protectedProcedure
    .input(z.object({ month: monthSchema, timeZone: timeZoneSchema }))
    .query(async ({ ctx, input }) => {
      await materializeRecurrences(ctx.session.user.id, input.timeZone);
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

  getRecurrences: protectedProcedure.query(({ ctx }) =>
    db.financeRecurrence.findMany({
      where: { userId: ctx.session.user.id, active: true },
      orderBy: [{ type: 'asc' }, { dayOfMonth: 'asc' }, { id: 'asc' }],
    }),
  ),

  createRecurrence: protectedProcedure
    .input(z.object({ recurrence: financeRecurrenceInputSchema, timeZone: timeZoneSchema }))
    .mutation(async ({ ctx, input }) => {
      const recurrence = await db.financeRecurrence.create({
        data: { ...input.recurrence, userId: ctx.session.user.id },
      });
      await materializeRecurrences(ctx.session.user.id, input.timeZone);
      return recurrence;
    }),

  /** Changes apply to the months generated from now on; past entries are left untouched. */
  updateRecurrence: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        recurrence: financeRecurrenceInputSchema,
        timeZone: timeZoneSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOwnRecurrence(input.id, ctx.session.user.id);
      const { startMonth: _startMonth, type: _type, ...changes } = input.recurrence;
      const recurrence = await db.financeRecurrence.update({
        where: { id: input.id },
        data: changes,
      });
      await materializeRecurrences(ctx.session.user.id, input.timeZone);
      return recurrence;
    }),

  stopRecurrence: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnRecurrence(input.id, ctx.session.user.id);
      await db.financeRecurrence.update({ where: { id: input.id }, data: { active: false } });
      return { id: input.id };
    }),
});
