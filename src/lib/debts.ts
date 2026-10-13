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
  transactionId?: string | null;
  debtReopenedAt?: Date | null;
  participants: { userId: number; amount: bigint }[];
}

export interface SettlementTargetRow {
  settlementId: string;
  expenseId: string;
  order: number;
}

export type DebtBucket = { kind: 'fixed' } | { kind: 'variable'; section: string };

export interface DebtItem {
  expenseId: string;
  debtorId: number;
  creditorId: number;
  category: string;
  bucket: DebtBucket;
  amount: bigint;
  covered: bigint;
  remaining: bigint;
  status: 'pending' | 'partial' | 'settled' | 'compensated';
  /** Imported fixed expense covered by the pre-app history (can be reopened) */
  coveredByHistory: boolean;
  reopened: boolean;
}

export interface OwedSummary {
  fixed: bigint;
  bySection: Record<string, bigint>;
  total: bigint;
}

export interface PairDebts {
  /** Overall balance, the same one the Balances screen shows */
  net: bigint;
  netDebtorId: number | null;
  /** Debts only; payments are not listed */
  items: DebtItem[];
  /** What is still pending, per debtor */
  owed: Record<number, OwedSummary>;
  /** Money paid in advance: the other member owes it to `userId` */
  advance: { userId: number; amount: bigint } | null;
}

const FIXED_ITEMS = new Set(['rent', 'mortgage', 'insurance']);
const FOOD_ITEMS = new Set(['groceries', 'food']);
const LEISURE_ITEMS = new Set(['diningOut', 'liquor']);
const PAYMENT_TYPES = new Set(['SETTLEMENT', 'CURRENCY_CONVERSION']);

/** Fixed costs never compensate: they are only covered by a payment that picks them. */
export const isFixedDebt = (category: string, recurring: boolean) =>
  recurring || FIXED_ITEMS.has(category) || 'utilities' === categorySection(category);

/** Old priority order, still used to spread payments imported from Tricount. */
export const debtPriority = (category: string, recurring: boolean): DebtPriority => {
  const section = categorySection(category);
  if (isFixedDebt(category, recurring)) {
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

const isImported = (expense: DebtExpense) =>
  expense.transactionId?.startsWith('tricount:') ?? false;

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

interface Work extends DebtItem {
  row: PairRow;
  byPayment: bigint;
}

const byAge = (a: Work, b: Work) =>
  a.row.expense.expenseDate.getTime() - b.row.expense.expenseDate.getTime() ||
  a.row.expense.createdAt.getTime() - b.row.expense.createdAt.getTime() ||
  a.expenseId.localeCompare(b.expenseId);

const byPriorityThenAge = (a: Work, b: Work) =>
  debtPriority(a.category, null !== a.row.expense.recurrenceId) -
    debtPriority(b.category, null !== b.row.expense.recurrenceId) || byAge(a, b);

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** Covers up to `available` of the debt and returns what is left. */
const cover = (debt: Work, available: bigint, payment: boolean) => {
  const used = min(available, debt.remaining);
  debt.covered += used;
  debt.remaining -= used;
  if (payment) {
    debt.byPayment += used;
  }
  return available - used;
};

const statusOf = (debt: Work): DebtItem['status'] => {
  if (0n === debt.remaining) {
    return 0n < debt.byPayment ? 'settled' : 'compensated';
  }
  return 0n === debt.covered ? 'pending' : 'partial';
};

/**
 * Per-expense debt status between two people (one group, one currency).
 *
 * 1. Payments that picked debts cover those debts.
 * 2. Payments imported from Tricount cover the payer's debts by the old priority order.
 * 3. Imported fixed debts are compensated by the other member's variable debts.
 * 4. Variable debts compensate each other within their category section.
 * 5. Remaining payments cover variable debts, oldest first; any excess is an advance.
 *
 * Fixed debts created in the app are only ever covered by step 1.
 */
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

  const debts: Work[] = rows
    .filter((row) => !PAYMENT_TYPES.has(row.expense.splitType))
    .map((row) => {
      const recurring = null !== row.expense.recurrenceId;
      return {
        row,
        expenseId: row.expense.id,
        debtorId: row.debtorId,
        creditorId: row.creditorId,
        category: row.expense.category,
        bucket: isFixedDebt(row.expense.category, recurring)
          ? { kind: 'fixed' }
          : { kind: 'variable', section: categorySection(row.expense.category) },
        amount: row.amount,
        covered: 0n,
        remaining: row.amount,
        status: 'pending',
        coveredByHistory: false,
        reopened: Boolean(row.expense.debtReopenedAt),
        byPayment: 0n,
      };
    });
  const debtsOf = (userId: number) =>
    debts.filter((d) => d.debtorId === userId && 0n < d.remaining);
  const variableDebtsOf = (userId: number) =>
    debtsOf(userId)
      .filter((d) => 'variable' === d.bucket.kind)
      .sort(byAge);

  // A payment row "C owes D" is a credit of D (the payer) against D's debts to C.
  const free = new Map<number, bigint>([
    [userA, 0n],
    [userB, 0n],
  ]);
  const history = new Map<number, bigint>([
    [userA, 0n],
    [userB, 0n],
  ]);
  const add = (map: Map<number, bigint>, userId: number, amount: bigint) =>
    map.set(userId, (map.get(userId) ?? 0n) + amount);

  // 1. Payments that picked debts.
  rows
    .filter((row) => PAYMENT_TYPES.has(row.expense.splitType))
    .forEach((payment) => {
      const payer = payment.creditorId;
      const chosen = targets
        .filter((t) => t.settlementId === payment.expense.id)
        .sort((a, b) => a.order - b.order)
        .map((t) => debts.find((d) => d.expenseId === t.expenseId && d.debtorId === payer))
        .filter((d): d is Work => undefined !== d);
      if (0 < chosen.length) {
        add(
          free,
          payer,
          chosen.reduce((available, debt) => cover(debt, available, true), payment.amount),
        );
      } else {
        add(isImported(payment.expense) ? history : free, payer, payment.amount);
      }
    });

  // 2. Imported payments, old priority order, skipping reopened debts.
  [userA, userB].forEach((userId) => {
    let available = history.get(userId) ?? 0n;
    debtsOf(userId)
      .filter((d) => !d.reopened)
      .sort(byPriorityThenAge)
      .forEach((debt) => {
        const before = available;
        available = cover(debt, available, true);
        if (before !== available && 'fixed' === debt.bucket.kind) {
          debt.coveredByHistory = true;
        }
      });
    add(free, userId, available);
  });

  // 3. Imported fixed debts are paid by default: the other member's variable debts compensate them.
  debts
    .filter(
      (d) =>
        'fixed' === d.bucket.kind && isImported(d.row.expense) && !d.reopened && 0n < d.remaining,
    )
    .sort(byAge)
    .forEach((fixed) => {
      variableDebtsOf(fixed.creditorId).forEach((other) => {
        const used = min(fixed.remaining, other.remaining);
        if (0n < used) {
          cover(fixed, used, false);
          cover(other, used, false);
          fixed.coveredByHistory = true;
        }
      });
    });

  // 4. Variable debts compensate each other within their section.
  const sections = new Set(
    debts.flatMap((d) => ('variable' === d.bucket.kind ? [d.bucket.section] : [])),
  );
  sections.forEach((section) => {
    const inSection = (userId: number) =>
      variableDebtsOf(userId).filter(
        (d) => 'variable' === d.bucket.kind && section === d.bucket.section,
      );
    const total = (list: Work[]) => list.reduce((sum, d) => sum + d.remaining, 0n);
    const ofA = inSection(userA);
    const ofB = inSection(userB);
    const offset = min(total(ofA), total(ofB));
    [ofA, ofB].forEach((list) => {
      list.reduce((available, debt) => cover(debt, available, false), offset);
    });
  });

  // 5. Free payments: net them, then cover variable debts oldest first; the rest is an advance.
  const offset = min(free.get(userA) ?? 0n, free.get(userB) ?? 0n);
  let advance: PairDebts['advance'] = null;
  [userA, userB].forEach((userId) => {
    const available = variableDebtsOf(userId).reduce(
      (left, debt) => cover(debt, left, true),
      (free.get(userId) ?? 0n) - offset,
    );
    if (0n < available) {
      advance = { userId, amount: available };
    }
  });

  const owed: Record<number, OwedSummary> = {};
  [userA, userB].forEach((userId) => {
    const summary: OwedSummary = { fixed: 0n, bySection: {}, total: 0n };
    debtsOf(userId).forEach((d) => {
      if ('fixed' === d.bucket.kind) {
        summary.fixed += d.remaining;
      } else {
        summary.bySection[d.bucket.section] =
          (summary.bySection[d.bucket.section] ?? 0n) + d.remaining;
      }
      summary.total += d.remaining;
    });
    owed[userId] = summary;
  });

  return {
    net: owedByA > owedByB ? owedByA - owedByB : owedByB - owedByA,
    netDebtorId: owedByA === owedByB ? null : owedByA > owedByB ? userA : userB,
    owed,
    advance,
    items: debts.map(({ row: _row, byPayment: _byPayment, ...item }, index) => ({
      ...item,
      status: statusOf(debts[index]!),
    })),
  };
};
