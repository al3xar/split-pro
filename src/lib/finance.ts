import { z } from 'zod';

import { type FinanceEntryKind } from './analytics';
import { CATEGORIES } from './category';

/** Personal expenses use SplitPro's own categories (sections and their items). */
const EXPENSE_CATEGORIES = [
  ...new Set(
    Object.entries(CATEGORIES).flatMap(([section, items]) => [
      section,
      ...items.filter((item) => 'other' !== item),
    ]),
  ),
];

export const FINANCE_CATEGORIES = {
  INCOME: ['salary', 'bonus', 'freelance', 'rental', 'benefits', 'gift', 'compensation', 'other'],
  INVESTMENT: ['funds', 'stocks', 'crypto', 'pension', 'deposit', 'realEstate', 'other'],
  EXPENSE: EXPENSE_CATEGORIES,
} satisfies Record<FinanceEntryKind, readonly string[]>;

export const FINANCE_ENTRY_KINDS = [
  'INCOME',
  'INVESTMENT',
] as const satisfies readonly FinanceEntryKind[];

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export const monthSchema = z.string().regex(MONTH_REGEX);

export const timeZoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Invalid time zone');

const financeFieldsSchema = z.object({
  type: z.enum(['INCOME', 'INVESTMENT', 'EXPENSE']),
  amount: z.bigint().positive(),
  currency: z.string().min(3).max(3),
  category: z.string().min(1),
  description: z.string().max(200).default(''),
});

const hasCategoryOfType = (entry: { type: FinanceEntryKind; category: string }) =>
  (FINANCE_CATEGORIES[entry.type] as readonly string[]).includes(entry.category);

const categoryError = { message: 'Invalid category for this type', path: ['category'] };

export const financeEntryInputSchema = financeFieldsSchema
  .extend({ date: z.date() })
  .refine(hasCategoryOfType, categoryError);

export const financeRecurrenceInputSchema = financeFieldsSchema
  .extend({ dayOfMonth: z.number().int().min(1).max(31), startMonth: monthSchema })
  .refine(hasCategoryOfType, categoryError);

export type FinanceRecurrenceInput = z.infer<typeof financeRecurrenceInputSchema>;

export type FinanceEntryInput = z.infer<typeof financeEntryInputSchema>;

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const toMonthIndex = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  return year * 12 + monthNumber - 1;
};

const fromMonthIndex = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

export const datePartsInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
};

/** The pay day of a month (clamped to its length) at noon UTC, so it stays on that day in any time zone. */
export const occurrenceDate = (month: string, dayOfMonth: number) => {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const day = Math.min(dayOfMonth, daysInMonth(year, monthNumber));
  return new Date(Date.UTC(year, monthNumber - 1, day, 12));
};

/**
 * Months (oldest first) whose recurring entry is due and not generated yet. The current
 * month is only due once its pay day has arrived.
 */
export const pendingOccurrences = (
  recurrence: { startMonth: string; lastGeneratedMonth: string | null; dayOfMonth: number },
  today: { year: number; month: number; day: number },
): string[] => {
  const currentIndex = today.year * 12 + today.month - 1;
  const payDayThisMonth = Math.min(recurrence.dayOfMonth, daysInMonth(today.year, today.month));
  const lastDueIndex = today.day >= payDayThisMonth ? currentIndex : currentIndex - 1;
  const firstIndex = Math.max(
    toMonthIndex(recurrence.startMonth),
    recurrence.lastGeneratedMonth ? toMonthIndex(recurrence.lastGeneratedMonth) + 1 : -Infinity,
  );
  const count = Math.max(0, lastDueIndex - firstIndex + 1);
  return Array.from({ length: count }, (_, i) => fromMonthIndex(firstIndex + i));
};

/** First and last instant that can belong to a month in any time zone (±14h). */
export const monthBounds = (firstMonth: string, lastMonth: string) => {
  const [fy, fm] = firstMonth.split('-').map(Number) as [number, number];
  const [ly, lm] = lastMonth.split('-').map(Number) as [number, number];
  const margin = 14 * 60 * 60 * 1000;
  return {
    gte: new Date(Date.UTC(fy, fm - 1, 1) - margin),
    lt: new Date(Date.UTC(ly, lm, 1) + margin),
  };
};
