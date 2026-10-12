import { householdStats, periodRange } from '~/lib/household';

const NOW = new Date('2026-10-12T10:00:00Z');
const TZ = 'Europe/Madrid';

describe('periodRange', () => {
  it('month starts at local midnight on day 1 and compares with the previous month', () => {
    const range = periodRange('month', NOW, TZ);
    expect(range.from?.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(range.previousFrom?.toISOString()).toBe('2026-08-31T22:00:00.000Z');
    expect(range.previousTo?.toISOString()).toBe('2026-09-30T22:00:00.000Z');
  });

  it('quarter covers the current month and the two before it', () => {
    const range = periodRange('quarter', NOW, TZ);
    expect(range.from?.toISOString()).toBe('2026-07-31T22:00:00.000Z');
    expect(range.previousFrom?.toISOString()).toBe('2026-04-30T22:00:00.000Z');
    expect(range.previousTo?.toISOString()).toBe('2026-07-31T22:00:00.000Z');
  });

  it('year starts on 1 January in winter time', () => {
    const range = periodRange('year', NOW, TZ);
    expect(range.from?.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    expect(range.previousFrom?.toISOString()).toBe('2024-12-31T23:00:00.000Z');
  });

  it('all has no bounds', () => {
    expect(periodRange('all', NOW, TZ)).toEqual({
      from: null,
      previousFrom: null,
      previousTo: null,
    });
  });
});

describe('householdStats', () => {
  const A = 1;
  const B = 2;
  const expense = (amount: bigint, paidBy: number, category: string, splitType = 'EQUAL') => ({
    amount,
    paidBy,
    category,
    splitType,
  });

  it('totals categories and payers, excluding payments and currency conversions', () => {
    const stats = householdStats([
      expense(90000n, A, 'rent'),
      expense(6000n, B, 'groceries'),
      expense(4000n, A, 'diningOut'),
      expense(10000n, B, 'general', 'SETTLEMENT'),
      expense(5000n, A, 'general', 'CURRENCY_CONVERSION'),
    ]);

    expect(stats.total).toBe(100000n);
    expect(stats.categories.map((c) => [c.section, c.amount])).toEqual([
      ['home', 90000n],
      ['food', 10000n],
    ]);
    expect(stats.payers).toEqual([
      {
        userId: A,
        amount: 94000n,
        sections: [
          { section: 'home', amount: 90000n },
          { section: 'food', amount: 4000n },
        ],
      },
      { userId: B, amount: 6000n, sections: [{ section: 'food', amount: 6000n }] },
    ]);
  });
});
