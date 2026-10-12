import { type CategoryTotals, byAmountDesc, categorySection, toCategoryTotals } from './analytics';
import { type CategorySection } from './category';
import { datePartsInTimeZone } from './finance';

export type HouseholdPeriod = 'month' | 'quarter' | 'year' | 'all';

export const HOUSEHOLD_PERIODS = [
  'month',
  'quarter',
  'year',
  'all',
] as const satisfies readonly HouseholdPeriod[];

const EXCLUDED_SPLIT_TYPES = new Set(['SETTLEMENT', 'CURRENCY_CONVERSION']);

/** The instant of local midnight on the first day of a month in a time zone. */
const zonedMonthStart = (year: number, month: number, timeZone: string) => {
  const guess = Date.UTC(year, month - 1, 1);
  const local = datePartsInTimeZone(new Date(guess), timeZone);
  const hourFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const [hours, minutes] = hourFormatter.format(new Date(guess)).split(':').map(Number) as [
    number,
    number,
  ];
  // Offset of the zone at `guess`, in ms (local wall time minus UTC).
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, hours, minutes);
  return new Date(guess - (localAsUtc - guess));
};

const shiftMonths = (year: number, month: number, delta: number) => {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

export const periodRange = (
  period: HouseholdPeriod,
  now: Date,
  timeZone: string,
): { from: Date | null; previousFrom: Date | null; previousTo: Date | null } => {
  if ('all' === period) {
    return { from: null, previousFrom: null, previousTo: null };
  }
  const today = datePartsInTimeZone(now, timeZone);
  const length = 'month' === period ? 1 : 'quarter' === period ? 3 : 12;
  const start =
    'year' === period
      ? { year: today.year, month: 1 }
      : shiftMonths(today.year, today.month, 1 - length);
  const previous = shiftMonths(start.year, start.month, -length);
  const from = zonedMonthStart(start.year, start.month, timeZone);
  return {
    from,
    previousFrom: zonedMonthStart(previous.year, previous.month, timeZone),
    previousTo: from,
  };
};

export interface HouseholdStats {
  total: bigint;
  categories: CategoryTotals[];
  payers: {
    userId: number;
    amount: bigint;
    sections: { section: CategorySection; amount: bigint }[];
  }[];
}

export const householdStats = (
  expenses: { amount: bigint; paidBy: number; category: string; splitType: string }[],
): HouseholdStats => {
  const counted = expenses.filter((e) => !EXCLUDED_SPLIT_TYPES.has(e.splitType));
  const byCategory = new Map<string, bigint>();
  const byPayer = new Map<number, Map<CategorySection, bigint>>();

  counted.forEach((e) => {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0n) + e.amount);
    const sections = byPayer.get(e.paidBy) ?? new Map<CategorySection, bigint>();
    const section = categorySection(e.category);
    sections.set(section, (sections.get(section) ?? 0n) + e.amount);
    byPayer.set(e.paidBy, sections);
  });

  const payers = [...byPayer.entries()]
    .map(([userId, sections]) => {
      const list = [...sections.entries()]
        .map(([section, amount]) => ({ section, amount }))
        .sort(byAmountDesc);
      return { userId, amount: list.reduce((sum, s) => sum + s.amount, 0n), sections: list };
    })
    .sort(byAmountDesc);

  return {
    total: counted.reduce((sum, e) => sum + e.amount, 0n),
    categories: toCategoryTotals(byCategory),
    payers,
  };
};
