import {
  type DebtExpense,
  type PairDebts,
  type SettlementTargetRow,
  allocateDebts,
  debtPriority,
  isFixedDebt,
} from '~/lib/debts';

const A = 1;
const B = 2;

let counter = 0;

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n, 10));

/** An expense paid by `paidBy` where the other member owes `owed`. */
const expense = (
  overrides: Partial<DebtExpense> & { paidBy: number; owed: bigint },
): DebtExpense => {
  counter += 1;
  const { owed, ...rest } = overrides;
  const other = overrides.paidBy === A ? B : A;
  const amount = rest.amount ?? owed * 2n;
  return {
    id: `e${counter}`,
    amount,
    currency: 'EUR',
    category: 'general',
    splitType: 'EQUAL',
    expenseDate: day(counter),
    createdAt: day(counter),
    recurrenceId: null,
    transactionId: null,
    debtReopenedAt: null,
    participants: [
      { userId: overrides.paidBy, amount: amount - owed },
      { userId: other, amount: -owed },
    ],
    ...rest,
  };
};

/** `from` pays `amount` to the other member. */
const payment = (from: number, amount: bigint, extra: Partial<DebtExpense> = {}) =>
  expense({ paidBy: from, owed: amount, amount, splitType: 'SETTLEMENT', ...extra });

const allocate = (expenses: DebtExpense[], targets: SettlementTargetRow[] = []): PairDebts =>
  allocateDebts({ userA: A, userB: B, currency: 'EUR', expenses, targets });

const item = (result: PairDebts, expenseId: string) =>
  result.items.find((i) => i.expenseId === expenseId)!;

const pending = (result: PairDebts, userId: number) =>
  result.items.filter((i) => i.debtorId === userId).reduce((sum, i) => sum + i.remaining, 0n);

/** Signed: what A still owes B according to the allocation. */
const signedPending = (result: PairDebts) =>
  pending(result, A) -
  pending(result, B) +
  (result.advance?.userId === B ? result.advance.amount : 0n) -
  (result.advance?.userId === A ? result.advance.amount : 0n);

const signedNet = (result: PairDebts) =>
  result.netDebtorId === A ? result.net : result.netDebtorId === B ? -result.net : 0n;

beforeEach(() => {
  counter = 0;
});

describe('isFixedDebt / debtPriority', () => {
  it.each([
    ['rent', false, true],
    ['electricity', false, true],
    ['gas', false, true],
    ['utilities', false, true],
    ['insurance', false, true],
    ['groceries', false, false],
    ['diningOut', false, false],
    ['music', true, true],
  ])('%s (recurring %s) fixed=%s', (category, recurring, fixed) => {
    expect(isFixedDebt(category, recurring)).toBe(fixed);
  });

  it('keeps the old priority order for imported payments', () => {
    expect(debtPriority('rent', false)).toBe(1);
    expect(debtPriority('groceries', false)).toBe(2);
    expect(debtPriority('general', false)).toBe(3);
    expect(debtPriority('diningOut', false)).toBe(4);
  });
});

describe('allocateDebts', () => {
  it('ten dinners never cover the rent', () => {
    const rent = expense({ paidBy: B, owed: 50000n, category: 'rent' });
    const dinners = Array.from({ length: 10 }, () =>
      expense({ paidBy: A, owed: 5000n, category: 'diningOut' }),
    );
    const result = allocate([rent, ...dinners]);
    expect(item(result, rent.id)).toMatchObject({ remaining: 50000n, status: 'pending' });
    dinners.forEach((d) => expect(item(result, d.id).status).toBe('pending'));
    expect(result.owed[A]).toMatchObject({ fixed: 50000n, total: 50000n });
    expect(result.owed[B]).toMatchObject({ fixed: 0n, bySection: { food: 50000n } });
  });

  it('variable debts compensate only within their section', () => {
    const dinnerA = expense({ paidBy: A, owed: 3000n, category: 'diningOut' });
    const groceriesB = expense({ paidBy: B, owed: 1000n, category: 'groceries' });
    const cinemaB = expense({ paidBy: B, owed: 2000n, category: 'movies' });
    const result = allocate([dinnerA, groceriesB, cinemaB]);
    expect(item(result, groceriesB.id)).toMatchObject({ remaining: 0n, status: 'compensated' });
    expect(item(result, dinnerA.id)).toMatchObject({ remaining: 2000n, status: 'partial' });
    expect(item(result, cinemaB.id)).toMatchObject({ remaining: 2000n, status: 'pending' });
  });

  it('a payment without picked debts covers variable debts oldest first, never fixed', () => {
    const light = expense({ paidBy: B, owed: 4000n, category: 'electricity' });
    const old = expense({ paidBy: B, owed: 1000n, category: 'groceries' });
    const recent = expense({ paidBy: B, owed: 3000n, category: 'diningOut' });
    const pay = payment(A, 2000n);
    const result = allocate([light, old, recent, pay]);
    expect(item(result, light.id).remaining).toBe(4000n);
    expect(item(result, old.id)).toMatchObject({ remaining: 0n, status: 'settled' });
    expect(item(result, recent.id)).toMatchObject({ remaining: 2000n, status: 'partial' });
    expect(result.items.some((i) => i.expenseId === pay.id)).toBe(false);
  });

  it('an excess payment stays as an advance, and a later payment back cancels it', () => {
    const light = expense({ paidBy: B, owed: 4000n, category: 'electricity' });
    const pay = payment(A, 1500n);
    const result = allocate([light, pay]);
    expect(result.advance).toEqual({ userId: A, amount: 1500n });
    expect(item(result, light.id).remaining).toBe(4000n);

    const back = payment(B, 1500n);
    expect(allocate([light, pay, back]).advance).toBeNull();
  });

  it('a payment that picks a fixed debt covers it and the excess goes to variables', () => {
    const rent = expense({ paidBy: B, owed: 50000n, category: 'rent' });
    const food = expense({ paidBy: B, owed: 3000n, category: 'groceries' });
    const pay = payment(A, 52000n);
    const result = allocate(
      [rent, food, pay],
      [{ settlementId: pay.id, expenseId: rent.id, order: 0 }],
    );
    expect(item(result, rent.id)).toMatchObject({ remaining: 0n, status: 'settled' });
    expect(item(result, food.id)).toMatchObject({ remaining: 1000n, status: 'partial' });
  });

  it('alternating rent never cancels itself', () => {
    const october = expense({ paidBy: A, owed: 50000n, category: 'rent' });
    const november = expense({ paidBy: B, owed: 50000n, category: 'rent' });
    const result = allocate([october, november]);
    expect(item(result, october.id).status).toBe('pending');
    expect(item(result, november.id).status).toBe('pending');
    expect(result.net).toBe(0n);
  });

  it('a recurring leisure expense is fixed', () => {
    const netflix = expense({ paidBy: A, owed: 700n, category: 'movies', recurrenceId: 3 });
    const cinema = expense({ paidBy: B, owed: 700n, category: 'movies' });
    const result = allocate([netflix, cinema]);
    expect(item(result, netflix.id).bucket).toEqual({ kind: 'fixed' });
    expect(item(result, netflix.id).status).toBe('pending');
    expect(item(result, cinema.id).status).toBe('pending');
  });

  describe('history imported from Tricount', () => {
    const imported = (n: number) => ({ transactionId: `tricount:${n}` });

    it('imported payments cover fixed debts first', () => {
      const food = expense({ paidBy: B, owed: 2000n, category: 'groceries', ...imported(1) });
      const rent = expense({ paidBy: B, owed: 50000n, category: 'rent', ...imported(2) });
      const pay = payment(A, 50000n, imported(3));
      const result = allocate([food, rent, pay]);
      expect(item(result, rent.id)).toMatchObject({ remaining: 0n, coveredByHistory: true });
      expect(item(result, food.id).remaining).toBe(2000n);
    });

    it('imported fixed debts are compensated by the other member variable debts', () => {
      const insurance = expense({ paidBy: A, owed: 6000n, category: 'insurance', ...imported(1) });
      const sofa = expense({ paidBy: B, owed: 10000n, category: 'furniture', ...imported(2) });
      const result = allocate([insurance, sofa]);
      expect(item(result, insurance.id)).toMatchObject({
        remaining: 0n,
        status: 'compensated',
        coveredByHistory: true,
      });
      expect(item(result, sofa.id).remaining).toBe(4000n);
    });

    it('fixed debts created in the app are not compensated by the history', () => {
      const light = expense({ paidBy: A, owed: 3500n, category: 'electricity' });
      const sofa = expense({ paidBy: B, owed: 10000n, category: 'furniture', ...imported(1) });
      const result = allocate([light, sofa]);
      expect(item(result, light.id).status).toBe('pending');
      expect(item(result, sofa.id).status).toBe('pending');
    });

    it('a reopened imported fixed debt stays pending and the money goes elsewhere', () => {
      const rent = expense({
        paidBy: B,
        owed: 50000n,
        category: 'rent',
        debtReopenedAt: day(40),
        ...imported(1),
      });
      const food = expense({ paidBy: B, owed: 2000n, category: 'groceries', ...imported(2) });
      const pay = payment(A, 50000n, imported(3));
      const result = allocate([rent, food, pay]);
      expect(item(result, rent.id)).toMatchObject({ remaining: 50000n, reopened: true });
      expect(item(result, food.id).remaining).toBe(0n);
      expect(result.advance).toEqual({ userId: A, amount: 48000n });
    });
  });

  it('keeps the same net balance as the Balances screen (random scenarios)', () => {
    let seed = 42;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const categories = ['rent', 'electricity', 'groceries', 'diningOut', 'movies', 'furniture'];
    for (let run = 0; 200 > run; run += 1) {
      counter = 0;
      const expenses: DebtExpense[] = [];
      const targets: SettlementTargetRow[] = [];
      const count = 1 + random(12);
      for (let i = 0; count > i; i += 1) {
        const paidBy = 0 === random(2) ? A : B;
        const imported = 0 === random(3) ? { transactionId: `tricount:${run}-${i}` } : {};
        const reopened = 0 === random(5) ? { debtReopenedAt: day(1) } : {};
        if (0 === random(4)) {
          const pay = payment(paidBy, BigInt(1 + random(60000)), imported);
          const owed = expenses.filter((e) => e.paidBy !== paidBy && 'EQUAL' === e.splitType);
          if (0 < owed.length && 0 === random(2)) {
            targets.push({
              settlementId: pay.id,
              expenseId: owed[random(owed.length)]!.id,
              order: 0,
            });
          }
          expenses.push(pay);
        } else {
          expenses.push(
            expense({
              paidBy,
              owed: BigInt(1 + random(40000)),
              category: categories[random(categories.length)]!,
              recurrenceId: 0 === random(6) ? 1 : null,
              ...imported,
              ...reopened,
            }),
          );
        }
      }
      const result = allocate(expenses, targets);
      expect(signedPending(result)).toBe(signedNet(result));
      result.items.forEach((i) => {
        expect(i.remaining).toBeGreaterThanOrEqual(0n);
        expect(i.covered + i.remaining).toBe(i.amount);
      });
    }
  });
});
