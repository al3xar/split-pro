import { z } from 'zod';

import { type FinanceEntryKind } from './analytics';

export const FINANCE_CATEGORIES = {
  INCOME: ['salary', 'bonus', 'freelance', 'rental', 'benefits', 'other'],
  INVESTMENT: ['funds', 'stocks', 'crypto', 'pension', 'deposit', 'realEstate', 'other'],
} as const satisfies Record<FinanceEntryKind, readonly string[]>;

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

export const financeEntryInputSchema = z
  .object({
    type: z.enum(FINANCE_ENTRY_KINDS),
    amount: z.bigint().positive(),
    currency: z.string().min(3).max(3),
    category: z.string().min(1),
    description: z.string().max(200).default(''),
    date: z.date(),
  })
  .refine(
    (entry) => (FINANCE_CATEGORIES[entry.type] as readonly string[]).includes(entry.category),
    { message: 'Invalid category for this type', path: ['category'] },
  );

export type FinanceEntryInput = z.infer<typeof financeEntryInputSchema>;

/**
 * Same day (clamped to the month length) one month later, at local noon so the
 * entry never jumps to another month because of time zones.
 */
export const sameDayNextMonth = (date: Date): Date => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const daysInTargetMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(date.getDate(), daysInTargetMonth), 12);
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
