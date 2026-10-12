import registry from './mock/tricount_registry.json';

import {
  type ParsedTricount,
  buildTricountImport,
  mapTricountCategory,
  parseRegistry,
  parseTricountKey,
} from '~/lib/tricount';

describe('parseTricountKey', () => {
  it.each([
    ['https://tricount.com/tAbCdEf123', 'tAbCdEf123'],
    ['https://www.tricount.com/tAbCdEf123', 'tAbCdEf123'],
    ['tricount.com/tAbCdEf123', 'tAbCdEf123'],
    ['  tAbCdEf123 ', 'tAbCdEf123'],
  ])('accepts %s', (input, key) => {
    expect(parseTricountKey(input)).toBe(key);
  });

  it('rejects links to other domains', () => {
    expect(parseTricountKey('https://evil.example.com/tAbCdEf123')).toBeNull();
  });
});

describe('parseRegistry', () => {
  it('reads title, currency, members and entries', () => {
    const parsed = parseRegistry(registry);
    expect(parsed.title).toBe('Casa');
    expect(parsed.currency).toBe('EUR');
    expect(parsed.members).toEqual(['Ana', 'Luis']);
    expect(parsed.entries.map((e) => e.type)).toEqual([
      'NORMAL',
      'NORMAL',
      'BALANCE',
      'INCOME',
      'NORMAL',
    ]);
    expect(parsed.entries[0]).toMatchObject({
      uuid: 'u-rent',
      description: 'Alquiler octubre',
      payer: 'Ana',
      amount: 90000n,
      allocations: [
        { member: 'Ana', amount: 45000n },
        { member: 'Luis', amount: 45000n },
      ],
    });
    expect(parsed.entries[0]!.date.toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });

  it('fixes rounding so allocations sum to the total', () => {
    const parsed = parseRegistry(registry);
    const dinner = parsed.entries.find((e) => 'u-split3' === e.uuid)!;
    expect(dinner.allocations.reduce((sum, a) => sum + a.amount, 0n)).toBe(dinner.amount);
  });

  it('includes people who only appear in entries (e.g. former members)', () => {
    const withFormer = JSON.parse(JSON.stringify(registry)) as typeof registry;
    const entry = withFormer.Response[0]!.Registry.all_registry_entry[0]!.RegistryEntry;
    entry.allocations[1]!.membership.RegistryMembershipNonUser.alias.display_name = 'Marta';
    expect(parseRegistry(withFormer).members).toEqual(['Ana', 'Luis', 'Marta']);
  });

  it('rejects unknown shapes', () => {
    expect(() => parseRegistry({ Response: [] })).toThrow('INVALID_TRICOUNT');
  });
});

describe('mapTricountCategory', () => {
  it.each([
    ['UNCATEGORIZED', '', 'Alquiler octubre', 'rent'],
    ['UNCATEGORIZED', '', 'Factura luz', 'electricity'],
    ['UNCATEGORIZED', '', 'Fibra Movistar', 'internet'],
    ['UNCATEGORIZED', '', 'Mercadona', 'groceries'],
    ['UNCATEGORIZED', '', 'Gasolina', 'fuel'],
    ['RESTAURANTS', '', 'Cena', 'diningOut'],
    ['UNCATEGORIZED', '', 'Algo raro', 'general'],
  ])('%s / %s / %s → %s', (category, custom, description, expected) => {
    expect(mapTricountCategory(category, custom, description)).toBe(expected);
  });
});

describe('buildTricountImport', () => {
  const parsed: ParsedTricount = parseRegistry(registry);
  const ids = { Ana: 1, Luis: 2 };

  it('maps a normal expense to an exact split', () => {
    const { expenses } = buildTricountImport(parsed, ids, new Set());
    const rent = expenses.find((e) => 'tricount:u-rent' === e.transactionId)!;
    expect(rent).toMatchObject({
      paidBy: 1,
      amount: 90000n,
      splitType: 'EXACT',
      category: 'rent',
      currency: 'EUR',
    });
    expect(rent.participants).toEqual([
      { userId: 1, amount: 45000n },
      { userId: 2, amount: -45000n },
    ]);
  });

  it('maps a reimbursement to a settlement', () => {
    const { expenses } = buildTricountImport(parsed, ids, new Set());
    const transfer = expenses.find((e) => 'tricount:u-bal' === e.transactionId)!;
    expect(transfer).toMatchObject({ paidBy: 2, amount: 10000n, splitType: 'SETTLEMENT' });
    expect(transfer.participants).toEqual([
      { userId: 2, amount: 10000n },
      { userId: 1, amount: -10000n },
    ]);
  });

  it('maps income to a negative expense', () => {
    const { expenses } = buildTricountImport(parsed, ids, new Set());
    const income = expenses.find((e) => 'tricount:u-inc' === e.transactionId)!;
    expect(income.amount).toBe(-4000n);
    expect(income.participants).toEqual([
      { userId: 1, amount: -2000n },
      { userId: 2, amount: 2000n },
    ]);
  });

  it('skips entries already imported', () => {
    const { expenses, skipped } = buildTricountImport(parsed, ids, new Set(['tricount:u-rent']));
    expect(skipped).toBe(1);
    expect(expenses).toHaveLength(4);
  });
});
