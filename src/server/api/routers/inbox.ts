import type { Prisma } from '@prisma/client';
import { type ImportedTransactionStatus } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { guessCategory, matchRule, normalizeMerchant } from '~/lib/categoryGuess';
import { FINANCE_CATEGORIES } from '~/lib/finance';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { db } from '~/server/db';

const STATUSES = ['PENDING', 'SHARED', 'PERSONAL', 'INCOME', 'IGNORED'] as const;

const mappingSchema = z.object({
  date: z.number().int().min(0),
  description: z.number().int().min(0),
  amount: z.number().int().min(0).nullable(),
  debit: z.number().int().min(0).nullable(),
  credit: z.number().int().min(0).nullable(),
  currency: z.number().int().min(0).nullable(),
  decimal: z.enum([',', '.']),
  dateFormat: z.enum(['dd/MM/yyyy', 'dd-MM-yyyy', 'dd.MM.yyyy', 'yyyy-MM-dd', 'iso']),
  defaultCurrency: z.string().length(3),
});

const rememberRule = async (
  userId: number,
  description: string,
  action: ImportedTransactionStatus,
  category: string | null,
) => {
  const pattern = normalizeMerchant(description);
  if (3 > pattern.length) {
    return;
  }
  await db.transactionRule.upsert({
    where: { userId_pattern: { userId, pattern } },
    create: { userId, pattern, action, category },
    update: { action, category },
  });
};

const ownPending = async (userId: number, ids: string[]) => {
  const transactions = await db.importedTransaction.findMany({
    where: { id: { in: ids }, userId, status: 'PENDING' },
  });
  if (transactions.length !== ids.length) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Some movements are no longer pending' });
  }
  return transactions;
};

const validCategory = (type: 'INCOME' | 'EXPENSE', category: string | null | undefined) =>
  category && (FINANCE_CATEGORIES[type] as readonly string[]).includes(category)
    ? category
    : 'INCOME' === type
      ? 'other'
      : 'general';

export const inboxRouter = createTRPCRouter({
  /** What the inbox needs to open the add dialog: the household group and default currency. */
  context: protectedProcedure.query(async ({ ctx }) => {
    const group = await db.group.findFirst({
      where: {
        isHousehold: true,
        archivedAt: null,
        groupUsers: { some: { userId: ctx.session.user.id } },
      },
      orderBy: { householdSince: 'desc' },
      select: { id: true, name: true, defaultCurrency: true },
    });
    return {
      householdGroup: group,
      defaultCurrency:
        group?.defaultCurrency ?? ctx.session.user.defaultCurrency ?? ctx.session.user.currency,
    };
  }),

  pendingCount: protectedProcedure.query(({ ctx }) =>
    db.importedTransaction.count({ where: { userId: ctx.session.user.id, status: 'PENDING' } }),
  ),

  importRows: protectedProcedure
    .input(
      z.object({
        source: z.string().max(100),
        rows: z
          .array(
            z.object({
              date: z.date(),
              description: z.string().max(500),
              amount: z.bigint(),
              currency: z.string().length(3),
              hash: z.string().min(1).max(700),
            }),
          )
          .min(1)
          .max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { count } = await db.importedTransaction.createMany({
        data: input.rows
          .filter((row) => 0n !== row.amount)
          .map((row) => ({ ...row, userId: ctx.session.user.id, source: input.source })),
        skipDuplicates: true,
      });
      return { created: count, duplicates: input.rows.length - count };
    }),

  /** Movements with a suggestion from the user's rules or, failing that, keywords. */
  list: protectedProcedure
    .input(z.object({ status: z.enum(STATUSES) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const [transactions, rules] = await Promise.all([
        db.importedTransaction.findMany({
          where: { userId, status: input.status },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          take: 500,
        }),
        db.transactionRule.findMany({ where: { userId } }),
      ]);
      return transactions.map((t) => {
        const rule = matchRule(rules, t.description);
        return {
          ...t,
          pattern: normalizeMerchant(t.description),
          suggestion: rule
            ? { action: rule.action, category: rule.category, fromRule: true }
            : {
                action: (0n < t.amount ? 'INCOME' : null) as ImportedTransactionStatus | null,
                category: guessCategory(t.description),
                fromRule: false,
              },
        };
      });
    }),

  /** Personal expense, income or ignore — for one or several movements. */
  classify: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        action: z.enum(['PERSONAL', 'INCOME', 'IGNORED']),
        category: z.string().optional(),
        remember: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const transactions = await ownPending(userId, input.ids);

      await db.$transaction(async (tx) => {
        for (const t of transactions) {
          let financeEntryId: number | null = null;
          let category: string | null = null;
          if ('IGNORED' !== input.action) {
            const type = 'PERSONAL' === input.action ? 'EXPENSE' : 'INCOME';
            category = validCategory(type, input.category ?? guessCategory(t.description));
            const entry = await tx.financeEntry.create({
              data: {
                userId,
                type,
                amount: 0n > t.amount ? -t.amount : t.amount,
                currency: t.currency,
                category,
                description: t.description.slice(0, 200),
                date: t.date,
              },
            });
            financeEntryId = entry.id;
          }
          await tx.importedTransaction.update({
            where: { id: t.id },
            data: { status: input.action, category, financeEntryId },
          });
        }
      });

      if (input.remember) {
        await Promise.all(
          [...new Map(transactions.map((t) => [normalizeMerchant(t.description), t])).values()].map(
            (t) => rememberRule(userId, t.description, input.action, input.category ?? null),
          ),
        );
      }
      return { classified: transactions.length };
    }),

  /** Marks a movement as shared once its expense was saved from the add dialog. */
  linkExpense: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        expenseId: z.string().uuid(),
        remember: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const [transaction] = await ownPending(userId, [input.id]);
      const expense = await db.expense.findFirst({
        where: {
          id: input.expenseId,
          OR: [{ paidBy: userId }, { expenseParticipants: { some: { userId } } }],
        },
        select: { category: true },
      });
      if (!expense) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Expense not found' });
      }
      await db.importedTransaction.update({
        where: { id: input.id },
        data: { status: 'SHARED', expenseId: input.expenseId, category: expense.category },
      });
      if (input.remember) {
        await rememberRule(userId, transaction!.description, 'SHARED', expense.category);
      }
      return { id: input.id };
    }),

  /** Back to pending; removes the personal expense/income it created (shared expenses stay). */
  undo: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const transaction = await db.importedTransaction.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!transaction) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Movement not found' });
      }
      await db.$transaction([
        ...(transaction.financeEntryId
          ? [
              db.financeEntry.deleteMany({
                where: { id: transaction.financeEntryId, userId: ctx.session.user.id },
              }),
            ]
          : []),
        db.importedTransaction.update({
          where: { id: input.id },
          data: { status: 'PENDING', financeEntryId: null, expenseId: null, category: null },
        }),
      ]);
      return { id: input.id };
    }),

  profiles: protectedProcedure.query(({ ctx }) =>
    db.importProfile.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { updatedAt: 'desc' },
    }),
  ),

  saveProfile: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(60), mapping: mappingSchema }))
    .mutation(({ ctx, input }) =>
      db.importProfile.upsert({
        where: { userId_name: { userId: ctx.session.user.id, name: input.name } },
        create: {
          userId: ctx.session.user.id,
          name: input.name,
          mapping: input.mapping as Prisma.InputJsonValue,
        },
        update: { mapping: input.mapping as Prisma.InputJsonValue },
      }),
    ),
});
