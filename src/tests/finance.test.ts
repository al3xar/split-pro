import {
  datePartsInTimeZone,
  financeEntryInputSchema,
  monthBounds,
  occurrenceDate,
  pendingOccurrences,
} from '~/lib/finance';

describe('datePartsInTimeZone', () => {
  it('returns the calendar day in the given time zone', () => {
    // 23:30 UTC on 31 Oct is already 1 Nov in Madrid (UTC+1 in winter)
    expect(datePartsInTimeZone(new Date('2026-10-31T23:30:00Z'), 'Europe/Madrid')).toEqual({
      year: 2026,
      month: 11,
      day: 1,
    });
  });
});

describe('occurrenceDate', () => {
  it('uses the chosen day at noon UTC', () => {
    expect(occurrenceDate('2026-10', 25).toISOString()).toBe('2026-10-25T12:00:00.000Z');
  });

  it('clamps the day to the end of shorter months', () => {
    expect(occurrenceDate('2026-02', 31).toISOString()).toBe('2026-02-28T12:00:00.000Z');
    expect(occurrenceDate('2028-02', 30).toISOString()).toBe('2028-02-29T12:00:00.000Z');
  });
});

describe('pendingOccurrences', () => {
  const today = { year: 2026, month: 10, day: 12 };

  it('includes the current month once the pay day has arrived', () => {
    expect(
      pendingOccurrences({ startMonth: '2026-10', lastGeneratedMonth: null, dayOfMonth: 1 }, today),
    ).toEqual(['2026-10']);
  });

  it('waits for the pay day in the current month', () => {
    expect(
      pendingOccurrences(
        { startMonth: '2026-10', lastGeneratedMonth: null, dayOfMonth: 25 },
        today,
      ),
    ).toEqual([]);
  });

  it('catches up every missing month, oldest first', () => {
    expect(
      pendingOccurrences(
        { startMonth: '2026-06', lastGeneratedMonth: '2026-07', dayOfMonth: 25 },
        today,
      ),
    ).toEqual(['2026-08', '2026-09']);
  });

  it('never generates a month twice', () => {
    expect(
      pendingOccurrences(
        { startMonth: '2026-06', lastGeneratedMonth: '2026-10', dayOfMonth: 1 },
        today,
      ),
    ).toEqual([]);
  });

  it('does not generate before the start month', () => {
    expect(
      pendingOccurrences({ startMonth: '2026-12', lastGeneratedMonth: null, dayOfMonth: 1 }, today),
    ).toEqual([]);
  });

  it('crosses year boundaries', () => {
    expect(
      pendingOccurrences(
        { startMonth: '2025-11', lastGeneratedMonth: null, dayOfMonth: 28 },
        { year: 2026, month: 1, day: 30 },
      ),
    ).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('treats a day past the end of the month as its last day', () => {
    expect(
      pendingOccurrences(
        { startMonth: '2026-02', lastGeneratedMonth: null, dayOfMonth: 31 },
        { year: 2026, month: 2, day: 28 },
      ),
    ).toEqual(['2026-02']);
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

  it('accepts the gift and compensation income categories', () => {
    expect(financeEntryInputSchema.safeParse({ ...base, category: 'gift' }).success).toBe(true);
    expect(financeEntryInputSchema.safeParse({ ...base, category: 'compensation' }).success).toBe(
      true,
    );
  });

  it('rejects a category of the other type', () => {
    expect(financeEntryInputSchema.safeParse({ ...base, category: 'crypto' }).success).toBe(false);
  });

  it('rejects zero or negative amounts', () => {
    expect(financeEntryInputSchema.safeParse({ ...base, amount: 0n }).success).toBe(false);
  });
});
