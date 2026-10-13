import { type Prisma, type PrismaClient } from '@prisma/client';

import { type PairDebts, allocateDebts } from '~/lib/debts';
import { db } from '~/server/db';

type Client = PrismaClient | Prisma.TransactionClient;

export interface DebtExpenseMeta {
  name: string;
  category: string;
  splitType: string;
  expenseDate: Date;
  amount: bigint;
}

export type PairDebtsWithExpenses = PairDebts & { expenses: Record<string, DebtExpenseMeta> };

/**
 * Per-expense debt status between two users in one group (or outside groups when
 * `groupId` is null) and one currency.
 */
export const loadPairDebts = async (
  userId: number,
  friendId: number,
  groupId: number | null,
  currency: string,
  client: Client = db,
): Promise<PairDebtsWithExpenses> => {
  const expenses = await client.expense.findMany({
    where: {
      deletedAt: null,
      groupId,
      currency,
      paidBy: { in: [userId, friendId] },
      expenseParticipants: { some: { userId: { in: [userId, friendId] } } },
    },
    select: {
      id: true,
      name: true,
      paidBy: true,
      amount: true,
      currency: true,
      category: true,
      splitType: true,
      expenseDate: true,
      createdAt: true,
      recurrenceId: true,
      transactionId: true,
      debtReopenedAt: true,
      expenseParticipants: { select: { userId: true, amount: true } },
      settlementTargets: { select: { expenseId: true, order: true } },
    },
  });

  const result = allocateDebts({
    userA: userId,
    userB: friendId,
    currency,
    expenses: expenses.map((e) => ({ ...e, participants: e.expenseParticipants })),
    targets: expenses.flatMap((e) =>
      e.settlementTargets.map((t) => ({
        settlementId: e.id,
        expenseId: t.expenseId,
        order: t.order,
      })),
    ),
  });

  const relevant = new Set(result.items.map((i) => i.expenseId));
  return {
    ...result,
    expenses: Object.fromEntries(
      expenses
        .filter((e) => relevant.has(e.id))
        .map((e) => [
          e.id,
          {
            name: e.name,
            category: e.category,
            splitType: e.splitType,
            expenseDate: e.expenseDate,
            amount: e.amount,
          },
        ]),
    ),
  };
};
