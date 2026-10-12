import {
  type DebtExpense,
  type PairDebts,
  type SettlementTargetRow,
  allocateDebts,
  debtPriority,
} from '~/lib/debts';

const A = 1;
const B = 2;

let counter = 0;

/** An expense paid by `paidBy` where the other member owes `owed` (equal-split style rows). */
const expense = (
  overrides: Partial<DebtExpense> & { paidBy: number; owed: bigint; other?: number },
): DebtExpense => {
  counter += 1;
  const { owed, other = overrides.paidBy === A ? B : A, ...rest } = overrides;
  const amount = rest.amount ?? owed * 2n;
  return {
    id: `e${counter}`,
    amount,
    currency: 'EUR',
    category: 'general',
    splitType: 'EQUAL',
    expenseDate: new Date(`2026-10-${String(counter).padStart(2, '0')}T10:00:00Z`),
    createdAt: new Date(`2026-10-${String(counter).padStart(2, '0')}T10:00:00Z`),
    recurrenceId: null,
    participants: [
      { userId: overrides.paidBy, amount: amount - owed },
      { userId: other, amount: -owed },
    ],
    ...rest,
  };
};

const allocate = (expenses: DebtExpense[], targets: SettlementTargetRow[] = []): PairDebts =>
  allocateDebts({ userA: A, userB: B, currency: 'EUR', expenses, targets });

const item = (result: PairDebts, expenseId: string) =>
  result.items.find((i) => i.expenseId === expenseId)!;

const debtorRemaining = (result: PairDebts) =>
  result.items
    .filter((i) => i.debtorId === result.debtorId)
    .reduce((sum, i) => sum + i.remaining, 0n);

beforeEach(() => {
  counter = 0;
});

describe('debtPriority', () => {
  it.each([
    ['rent', 1],
    ['electricity', 1],
    ['utilities', 1],
    ['insurance', 1],
    ['groceries', 2],
    ['food', 2],
    ['diningOut', 4],
    ['movies', 4],
    ['entertainment', 4],
    ['fuel', 3],
    ['general', 3],
  ])('%s has priority %i', (category, priority) => {
    expect(debtPriority(category, false)).toBe(priority);
  });

  it('treats any recurring expense as fixed', () => {
    expect(debtPriority('groceries', true)).toBe(1);
  });
});

describe('allocateDebts', () => {
  it('rent paid by A, B owes 450; dinners paid by B 70 → rent partial, remaining 380', () => {
    const rent = expense({ paidBy: A, owed: 45000n, category: 'rent' });
    const dinner1 = expense({ paidBy: B, owed: 3000n, category: 'groceries' });
    const dinner2 = expense({ paidBy: B, owed: 4000n, category: 'diningOut' });

    const result = allocate([rent, dinner1, dinner2]);

    expect(result.debtorId).toBe(B);
    expect(result.creditorId).toBe(A);
    expect(result.net).toBe(38000n);
    expect(item(result, rent.id)).toMatchObject({
      status: 'partial',
      covered: 7000n,
      remaining: 38000n,
      priority: 1,
    });
    expect(item(result, dinner1.id).status).toBe('compensated');
    expect(debtorRemaining(result)).toBe(result.net);
  });

  it('priority beats age', () => {
    const dinner = expense({ paidBy: A, owed: 2000n, category: 'diningOut' });
    const rent = expense({ paidBy: A, owed: 45000n, category: 'rent' });
    const credit = expense({ paidBy: B, owed: 3000n, category: 'groceries' });

    const result = allocate([dinner, rent, credit]);

    expect(item(result, rent.id).covered).toBe(3000n);
    expect(item(result, dinner.id).covered).toBe(0n);
    expect(item(result, dinner.id).status).toBe('pending');
    expect(debtorRemaining(result)).toBe(result.net);
  });

  it('same priority oldest first', () => {
    const older = expense({ paidBy: A, owed: 4000n, category: 'groceries' });
    const newer = expense({ paidBy: A, owed: 4000n, category: 'groceries' });
    const credit = expense({ paidBy: B, owed: 5000n, category: 'fuel' });

    const result = allocate([newer, older, credit]);

    expect(item(result, older.id)).toMatchObject({ covered: 4000n, status: 'settled' });
    expect(item(result, newer.id)).toMatchObject({ covered: 1000n, status: 'partial' });
    expect(debtorRemaining(result)).toBe(result.net);
  });

  it('credits above a debt settle it and flip the debtor', () => {
    const rent = expense({ paidBy: A, owed: 45000n, category: 'rent' });
    const dinners = expense({ paidBy: B, owed: 46000n, category: 'diningOut' });

    const result = allocate([rent, dinners]);

    expect(result.debtorId).toBe(A);
    expect(result.net).toBe(1000n);
    expect(item(result, rent.id).status).toBe('compensated');
    expect(item(result, dinners.id)).toMatchObject({ status: 'partial', remaining: 1000n });
    expect(debtorRemaining(result)).toBe(result.net);
  });

  it('net zero has no debtor and everything compensated', () => {
    const one = expense({ paidBy: A, owed: 2000n });
    const two = expense({ paidBy: B, owed: 2000n });

    const result = allocate([one, two]);

    expect(result.debtorId).toBeNull();
    expect(result.creditorId).toBeNull();
    expect(result.net).toBe(0n);
    expect(result.items.every((i) => 'compensated' === i.status)).toBe(true);
  });

  it('targeted payment covers chosen debts first', () => {
    const rent = expense({ paidBy: A, owed: 45000n, category: 'rent' });
    const dinner = expense({ paidBy: A, owed: 2000n, category: 'diningOut' });
    const payment = expense({ paidBy: B, owed: 2000n, amount: 2000n, splitType: 'SETTLEMENT' });

    const result = allocate(
      [rent, dinner, payment],
      [{ settlementId: payment.id, expenseId: dinner.id, order: 0 }],
    );

    expect(item(result, dinner.id).status).toBe('settled');
    expect(item(result, rent.id)).toMatchObject({ status: 'pending', remaining: 45000n });
    expect(debtorRemaining(result)).toBe(result.net);
  });

  it('targeted payment leftover goes to the pool', () => {
    const rent = expense({ paidBy: A, owed: 45000n, category: 'rent' });
    const dinner = expense({ paidBy: A, owed: 2000n, category: 'diningOut' });
    const payment = expense({ paidBy: B, owed: 10000n, amount: 10000n, splitType: 'SETTLEMENT' });

    const result = allocate(
      [rent, dinner, payment],
      [{ settlementId: payment.id, expenseId: dinner.id, order: 0 }],
    );

    expect(item(result, dinner.id).status).toBe('settled');
    expect(item(result, rent.id).covered).toBe(8000n);
    expect(debtorRemaining(result)).toBe(result.net);
  });

  it('negative expense creates a reverse debt', () => {
    const refund: DebtExpense = {
      ...expense({ paidBy: A, owed: 0n }),
      amount: -3000n,
      participants: [
        { userId: A, amount: -1500n },
        { userId: B, amount: 1500n },
      ],
    };

    const result = allocate([refund]);

    expect(result.debtorId).toBe(A);
    expect(result.net).toBe(1500n);
    expect(item(result, refund.id)).toMatchObject({ debtorId: A, creditorId: B, amount: 1500n });
  });

  it('ignores third members and other currencies', () => {
    const rent = expense({ paidBy: A, owed: 45000n, category: 'rent' });
    const third = expense({ paidBy: 3, owed: 9000n, other: B });
    const thirdPaidByA = expense({ paidBy: A, owed: 7000n, other: 3 });
    const dollars = expense({ paidBy: B, owed: 10000n, currency: 'USD' });

    const result = allocate([rent, third, thirdPaidByA, dollars]);

    expect(result.items.map((i) => i.expenseId)).toEqual([rent.id]);
    expect(result.net).toBe(45000n);
    expect(debtorRemaining(result)).toBe(result.net);
  });
});
