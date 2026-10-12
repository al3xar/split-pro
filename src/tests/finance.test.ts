import { financeEntryInputSchema, monthBounds, sameDayNextMonth } from '~/lib/finance';

describe('sameDayNextMonth', () => {
  it('keeps the day of the month at local noon', () => {
    const next = sameDayNextMonth(new Date(2026, 8, 15, 9));
    expect([next.getFullYear(), next.getMonth(), next.getDate(), next.getHours()]).toEqual([
      2026, 9, 15, 12,
    ]);
  });

  it('clamps to the last day of a shorter month', () => {
    const next = sameDayNextMonth(new Date(2026, 0, 31));
    expect([next.getMonth(), next.getDate()]).toEqual([1, 28]);
  });

  it('rolls over the year', () => {
    const next = sameDayNextMonth(new Date(2026, 11, 5));
    expect([next.getFullYear(), next.getMonth()]).toEqual([2027, 0]);
  });
});

describe('monthBounds', () => {
  it('covers the whole range with a time zone margin', () => {
    const { gte, lt } = monthBounds('2026-01', '2026-03');
    expect(gte.toISOString()).toBe('2025-12-31T10:00:00.000Z');
    expect(lt.toISOString()).toBe('2026-04-01T14:00:00.000Z');
  });
});

describe('financeEntryInputSchema', () => {
  const base = {
    type: 'INCOME' as const,
    amount: 1000n,
    currency: 'EUR',
    category: 'salary',
    date: new Date(),
  };

  it('accepts a category of its own type', () => {
    expect(financeEntryInputSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a category of the other type', () => {
    expect(financeEntryInputSchema.safeParse({ ...base, category: 'crypto' }).success).toBe(false);
  });

  it('rejects zero or negative amounts', () => {
    expect(financeEntryInputSchema.safeParse({ ...base, amount: 0n }).success).toBe(false);
  });
});
