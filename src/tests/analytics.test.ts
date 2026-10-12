import {
  type AnalyticsExpense,
  type AnalyticsFinanceEntry,
  buildAnalytics,
  categorySection,
  expenseShare,
  monthKey,
  monthRange,
  shiftMonth,
} from '~/lib/analytics';

const ME = 1;
const PARTNER = 2;
const TZ = 'Europe/Madrid';

const expense = (overrides: Partial<AnalyticsExpense>): AnalyticsExpense => ({
  amount: 100_00n,
  paidBy: ME,
  category: 'groceries',
  expenseDate: new Date('2026-10-10T10:00:00Z'),
  myParticipantAmount: 50_00n,
  ...overrides,
});

const entry = (overrides: Partial<AnalyticsFinanceEntry>): AnalyticsFinanceEntry => ({
  type: 'INCOME',
  amount: 2000_00n,
  category: 'salary',
  date: new Date('2026-10-01T08:00:00Z'),
  ...overrides,
});

describe('categorySection', () => {
  it('maps an item to its section', () => {
    expect(categorySection('groceries')).toBe('food');
    expect(categorySection('rent')).toBe('home');
    expect(categorySection('fuel')).toBe('travel');
  });

  it('keeps a section name as is', () => {
    expect(categorySection('food')).toBe('food');
    expect(categorySection('general')).toBe('general');
  });

  it('falls back to general for unknown values', () => {
    expect(categorySection('does-not-exist')).toBe('general');
  });

  it('maps the gas utility before the travel section', () => {
    expect(categorySection('gas')).toBe('utilities');
  });
});

describe('monthKey', () => {
  it('buckets by the given time zone, not UTC', () => {
    // 1 Oct 00:00 in Madrid is 30 Sep 22:00 UTC
    expect(monthKey(new Date('2026-09-30T22:00:00Z'), TZ)).toBe('2026-10');
    expect(monthKey(new Date('2026-09-30T22:00:00Z'), 'UTC')).toBe('2026-09');
  });
});

describe('monthRange / shiftMonth', () => {
  it('returns the last N months ending at the given month, oldest first', () => {
    expect(monthRange('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('shifts months across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
  });
});

describe('expenseShare', () => {
  it('is half when I paid an equal split', () => {
    // I paid 100, my participant row is +50 (paid 100 - owe 50)
    expect(expenseShare(expense({}), ME)).toBe(50_00n);
  });

  it('is my debt when the partner paid', () => {
    expect(expenseShare(expense({ paidBy: PARTNER, myParticipantAmount: -30_00n }), ME)).toBe(
      30_00n,
    );
  });

  it('is the full amount when I paid and have no participant row', () => {
    expect(expenseShare(expense({ myParticipantAmount: null }), ME)).toBe(100_00n);
  });

  it('is zero when I paid entirely for the partner', () => {
    expect(expenseShare(expense({ myParticipantAmount: 100_00n }), ME)).toBe(0n);
  });
});

describe('buildAnalytics', () => {
  const months = monthRange('2026-10', 3);

  it('aggregates my spending, household spending, income, investments and savings', () => {
    const result = buildAnalytics({
      userId: ME,
      timeZone: TZ,
      months,
      expenses: [
        expense({}), // Groceries, my share 50
        expense({ category: 'rent', amount: 800_00n, myParticipantAmount: 400_00n }), // 400
        expense({
          category: 'fuel',
          amount: 60_00n,
          paidBy: PARTNER,
          myParticipantAmount: -30_00n,
          expenseDate: new Date('2026-09-15T10:00:00Z'),
        }),
      ],
      entries: [
        entry({}),
        entry({ type: 'INVESTMENT', amount: 300_00n, category: 'funds' }),
        entry({ amount: 1900_00n, date: new Date('2026-09-01T08:00:00Z') }),
      ],
    });

    const oct = result.months.find((m) => m.month === '2026-10')!;
    expect(oct).toEqual({
      month: '2026-10',
      expenses: 450_00n,
      householdExpenses: 900_00n,
      income: 2000_00n,
      investments: 300_00n,
      savings: 1550_00n,
    });

    const sep = result.months.find((m) => m.month === '2026-09')!;
    expect(sep.expenses).toBe(30_00n);
    expect(sep.savings).toBe(1870_00n);

    const aug = result.months.find((m) => m.month === '2026-08')!;
    expect(aug.expenses).toBe(0n);
  });

  it('breaks the last month down by section and item, largest first', () => {
    const result = buildAnalytics({
      userId: ME,
      timeZone: TZ,
      months,
      expenses: [
        expense({}),
        expense({ category: 'diningOut', myParticipantAmount: 80_00n }), // 20
        expense({ category: 'rent', amount: 800_00n, myParticipantAmount: 400_00n }), // 400
      ],
      entries: [],
    });

    expect(result.categories.map((c) => [c.section, c.amount])).toEqual([
      ['home', 400_00n],
      ['food', 70_00n],
    ]);
    expect(result.categories[1]!.items).toEqual([
      { category: 'groceries', amount: 50_00n },
      { category: 'diningOut', amount: 20_00n },
    ]);
  });

  it('ignores expenses and entries outside the month range', () => {
    const result = buildAnalytics({
      userId: ME,
      timeZone: TZ,
      months,
      expenses: [expense({ expenseDate: new Date('2026-01-10T10:00:00Z') })],
      entries: [entry({ date: new Date('2027-01-01T10:00:00Z') })],
    });

    expect(result.months.every((m) => 0n === m.expenses && 0n === m.income)).toBe(true);
    expect(result.categories).toEqual([]);
  });

  it('computes the savings rate and the change against the previous month', () => {
    const result = buildAnalytics({
      userId: ME,
      timeZone: TZ,
      months,
      expenses: [
        expense({ myParticipantAmount: 0n }), // 100 in October
        expense({ expenseDate: new Date('2026-09-10T10:00:00Z'), myParticipantAmount: 50_00n }), // 50 in September
      ],
      entries: [entry({ amount: 400_00n })],
    });

    expect(result.summary.savingsRate).toBeCloseTo(0.75);
    expect(result.summary.expensesChange).toBeCloseTo(1); // +100 %
  });

  it('has no savings rate without income and no change without a previous month', () => {
    const result = buildAnalytics({
      userId: ME,
      timeZone: TZ,
      months: ['2026-10'],
      expenses: [expense({})],
      entries: [],
    });

    expect(result.summary.savingsRate).toBeNull();
    expect(result.summary.expensesChange).toBeNull();
  });
});
