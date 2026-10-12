import { CATEGORIES, type CategorySection } from './category';

export type FinanceEntryKind = 'INCOME' | 'INVESTMENT';

export interface AnalyticsExpense {
  amount: bigint;
  paidBy: number;
  category: string;
  expenseDate: Date;
  /** ExpenseParticipant.amount of the current user (paid - owed), or null without a row */
  myParticipantAmount: bigint | null;
}

export interface AnalyticsFinanceEntry {
  type: FinanceEntryKind;
  amount: bigint;
  category: string;
  date: Date;
}

export interface MonthTotals {
  month: string;
  /** What the current user actually spends: their share of each expense */
  expenses: bigint;
  /** Full amount of the expenses the current user takes part in */
  householdExpenses: bigint;
  income: bigint;
  investments: bigint;
  /** Income - expenses (investments are part of the savings) */
  savings: bigint;
}

export interface CategoryTotals {
  section: CategorySection;
  amount: bigint;
  items: { category: string; amount: bigint }[];
}

export interface AnalyticsResult {
  months: MonthTotals[];
  /** Breakdown of the last month in the range */
  categories: CategoryTotals[];
  summary: {
    /** Savings / income of the last month, null without income */
    savingsRate: number | null;
    /** Relative change of expenses against the previous month, null without one */
    expensesChange: number | null;
  };
}

const SECTION_BY_ITEM = new Map<string, CategorySection>();
(Object.entries(CATEGORIES) as [CategorySection, readonly string[]][]).forEach(([section, items]) =>
  items
    .filter((item) => 'other' !== item && !SECTION_BY_ITEM.has(item))
    .forEach((item) => SECTION_BY_ITEM.set(item, section)),
);

export const categorySection = (category: string): CategorySection => {
  if (category in CATEGORIES) {
    return category as CategorySection;
  }
  return SECTION_BY_ITEM.get(category) ?? 'general';
};

const monthFormatters = new Map<string, Intl.DateTimeFormat>();

export const monthKey = (date: Date, timeZone: string): string => {
  let formatter = monthFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' });
    monthFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => 'year' === p.type)?.value;
  const month = parts.find((p) => 'month' === p.type)?.value;
  return `${year}-${month}`;
};

export const shiftMonth = (month: string, delta: number): string => {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (monthNumber - 1) + delta;
  const newYear = Math.floor(index / 12);
  const newMonth = (index % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, '0')}`;
};

export const monthRange = (endMonth: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => shiftMonth(endMonth, i - count + 1));

export const expenseShare = (expense: AnalyticsExpense, userId: number): bigint =>
  (expense.paidBy === userId ? expense.amount : 0n) - (expense.myParticipantAmount ?? 0n);

const relativeChange = (current: bigint, previous: bigint): number | null =>
  0n === previous ? null : Number(current - previous) / Number(previous);

export const byAmountDesc = (a: { amount: bigint }, b: { amount: bigint }) =>
  a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1;

/** Groups per-category amounts into sections, both sorted from largest to smallest. */
export const toCategoryTotals = (byCategory: Map<string, bigint>): CategoryTotals[] => {
  const sections = new Map<CategorySection, CategoryTotals>();
  byCategory.forEach((amount, category) => {
    const section = categorySection(category);
    const sectionTotals = sections.get(section) ?? { section, amount: 0n, items: [] };
    sectionTotals.amount += amount;
    sectionTotals.items.push({ category, amount });
    sections.set(section, sectionTotals);
  });
  return [...sections.values()]
    .filter((s) => 0n < s.amount)
    .map((s) => ({ ...s, items: s.items.sort(byAmountDesc) }))
    .sort(byAmountDesc);
};

export const buildAnalytics = ({
  userId,
  timeZone,
  months,
  expenses,
  entries,
}: {
  userId: number;
  timeZone: string;
  months: string[];
  expenses: AnalyticsExpense[];
  entries: AnalyticsFinanceEntry[];
}): AnalyticsResult => {
  const totals = new Map<string, MonthTotals>(
    months.map((month) => [
      month,
      { month, expenses: 0n, householdExpenses: 0n, income: 0n, investments: 0n, savings: 0n },
    ]),
  );
  const lastMonth = months.at(-1);
  const byCategory = new Map<string, bigint>();

  expenses.forEach((expense) => {
    const month = totals.get(monthKey(expense.expenseDate, timeZone));
    if (!month) {
      return;
    }
    const share = expenseShare(expense, userId);
    month.expenses += share;
    month.householdExpenses += expense.amount;
    if (month.month === lastMonth && 0n !== share) {
      byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0n) + share);
    }
  });

  entries.forEach((entry) => {
    const month = totals.get(monthKey(entry.date, timeZone));
    if (!month) {
      return;
    }
    if ('INCOME' === entry.type) {
      month.income += entry.amount;
    } else {
      month.investments += entry.amount;
    }
  });

  totals.forEach((month) => {
    month.savings = month.income - month.expenses;
  });

  const categories = toCategoryTotals(byCategory);

  const ordered = months.map((m) => totals.get(m)!);
  const current = ordered.at(-1);
  const previous = ordered.at(-2);

  return {
    months: ordered,
    categories,
    summary: {
      savingsRate:
        current && 0n < current.income ? Number(current.savings) / Number(current.income) : null,
      expensesChange:
        current && previous ? relativeChange(current.expenses, previous.expenses) : null,
    },
  };
};
