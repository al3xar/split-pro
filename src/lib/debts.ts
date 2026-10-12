import { categorySection } from './analytics';

export type DebtPriority = 1 | 2 | 3 | 4;

export interface DebtExpense {
  id: string;
  paidBy: number;
  amount: bigint;
  currency: string;
  category: string;
  splitType: string;
  expenseDate: Date;
  createdAt: Date;
  recurrenceId: number | null;
  participants: { userId: number; amount: bigint }[];
}

export interface SettlementTargetRow {
  settlementId: string;
  expenseId: string;
  order: number;
}

export interface DebtItem {
  expenseId: string;
  debtorId: number;
  creditorId: number;
  category: string;
  priority: DebtPriority;
  amount: bigint;
  covered: bigint;
  remaining: bigint;
  status: 'pending' | 'partial' | 'settled' | 'compensated';
}

export interface PairDebts {
  debtorId: number | null;
  creditorId: number | null;
  net: bigint;
  items: DebtItem[];
  remainingByPriority: Record<DebtPriority, bigint>;
}

const FIXED_ITEMS = new Set(['rent', 'mortgage', 'insurance']);
const FOOD_ITEMS = new Set(['groceries', 'food']);
const LEISURE_ITEMS = new Set(['diningOut', 'liquor']);

export const debtPriority = (category: string, recurring: boolean): DebtPriority => {
  const section = categorySection(category);
  if (recurring || FIXED_ITEMS.has(category) || 'utilities' === section) {
    return 1;
  }
  if (FOOD_ITEMS.has(category)) {
    return 2;
  }
  if (LEISURE_ITEMS.has(category) || 'entertainment' === section) {
    return 4;
  }
  return 3;
};

interface PairRow {
  expense: DebtExpense;
  debtorId: number;
  creditorId: number;
  amount: bigint;
}

/** What each pair member owes the other in every expense of the pair and currency. */
const pairRows = (userA: number, userB: number, currency: string, expenses: DebtExpense[]) =>
  expenses
    .filter((e) => e.currency === currency && (e.paidBy === userA || e.paidBy === userB))
    .flatMap((expense): PairRow[] => {
      const other = expense.paidBy === userA ? userB : userA;
      const row = expense.participants.find((p) => p.userId === other);
      if (!row || 0n === row.amount) {
        return [];
      }
      return 0n > row.amount
        ? [{ expense, debtorId: other, creditorId: expense.paidBy, amount: -row.amount }]
        : [{ expense, debtorId: expense.paidBy, creditorId: other, amount: row.amount }];
    });

const byPriorityThenAge = (a: DebtItem & { row: PairRow }, b: DebtItem & { row: PairRow }) =>
  a.priority - b.priority ||
  a.row.expense.expenseDate.getTime() - b.row.expense.expenseDate.getTime() ||
  a.row.expense.createdAt.getTime() - b.row.expense.createdAt.getTime() ||
  a.expenseId.localeCompare(b.expenseId);

const statusOf = (covered: bigint, amount: bigint): DebtItem['status'] => {
  if (0n === covered) {
    return 'pending';
  }
  return covered < amount ? 'partial' : 'settled';
};

export const allocateDebts = ({
  userA,
  userB,
  currency,
  expenses,
  targets,
}: {
  userA: number;
  userB: number;
  currency: string;
  expenses: DebtExpense[];
  targets: SettlementTargetRow[];
}): PairDebts => {
  const rows = pairRows(userA, userB, currency, expenses);
  const owedBy = (userId: number) =>
    rows.filter((r) => r.debtorId === userId).reduce((sum, r) => sum + r.amount, 0n);
  const owedByA = owedBy(userA);
  const owedByB = owedBy(userB);
  const debtorId = owedByA === owedByB ? null : owedByA > owedByB ? userA : userB;
  const creditorId = null === debtorId ? null : debtorId === userA ? userB : userA;
  const net = owedByA > owedByB ? owedByA - owedByB : owedByB - owedByA;

  const items = rows.map((row) => ({
    row,
    expenseId: row.expense.id,
    debtorId: row.debtorId,
    creditorId: row.creditorId,
    category: row.expense.category,
    priority: debtPriority(row.expense.category, null !== row.expense.recurrenceId),
    amount: row.amount,
    covered: row.debtorId === debtorId ? 0n : row.amount,
    remaining: row.debtorId === debtorId ? row.amount : 0n,
    status: (row.debtorId === debtorId ? 'pending' : 'compensated') as DebtItem['status'],
  }));

  const debts = items.filter((i) => i.debtorId === debtorId);
  const debtById = new Map(debts.map((d) => [d.expenseId, d]));
  const cover = (debt: (typeof debts)[number], available: bigint) => {
    const used = available < debt.remaining ? available : debt.remaining;
    debt.covered += used;
    debt.remaining -= used;
    return available - used;
  };

  // Credits of the debtor: what the creditor owes them, payments included.
  let pool = 0n;
  items
    .filter((i) => i.creditorId === debtorId)
    .forEach((credit) => {
      const chosen = targets
        .filter((t) => t.settlementId === credit.expenseId)
        .sort((a, b) => a.order - b.order)
        .map((t) => debtById.get(t.expenseId))
        .filter((d): d is (typeof debts)[number] => undefined !== d);
      pool += chosen.reduce((available, debt) => cover(debt, available), credit.amount);
    });

  [...debts].sort(byPriorityThenAge).forEach((debt) => {
    pool = cover(debt, pool);
  });

  const remainingByPriority: Record<DebtPriority, bigint> = { 1: 0n, 2: 0n, 3: 0n, 4: 0n };
  debts.forEach((d) => {
    remainingByPriority[d.priority] += d.remaining;
  });

  return {
    debtorId,
    creditorId,
    net,
    remainingByPriority,
    items: items.map(({ row: _row, ...item }) => ({
      ...item,
      status: item.debtorId === debtorId ? statusOf(item.covered, item.amount) : 'compensated',
    })),
  };
};
