import {
  detectMapping,
  parseAmount,
  parseCsv,
  parseStatementDate,
  toTransactions,
} from '~/lib/statement';

const SPANISH = `﻿Fecha operación;Fecha valor;Concepto;Importe;Saldo
01/10/2026;01/10/2026;"RECIBO ALQUILER; PISO";-900,00;1.234,56
03/10/2026;03/10/2026;MERCADONA VALENCIA;-45,30;1.189,26
03/10/2026;03/10/2026;MERCADONA VALENCIA;-45,30;1.143,96
28/10/2026;28/10/2026;NOMINA EMPRESA SL;2.100,00;3.243,96

`;

const TRADE_REPUBLIC = `"datetime","date","account_type","category","type","name","amount","currency"
"2026-10-02T18:31:47.160Z","2026-10-02","DEFAULT","CASH","CARD_TRANSACTION","LIDL","-53.060000","EUR"
"2026-10-05T09:00:00.000Z","2026-10-05","DEFAULT","CASH","TRANSFER_IN","Ana","200.000000","EUR"
`;

describe('parseCsv', () => {
  it('detects semicolons, strips BOM, keeps quoted separators and ignores blank lines', () => {
    const parsed = parseCsv(SPANISH);
    expect(parsed.headers[0]).toBe('Fecha operación');
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows[0]![2]).toBe('RECIBO ALQUILER; PISO');
  });

  it('detects commas and tabs', () => {
    expect(parseCsv(TRADE_REPUBLIC).headers).toContain('amount');
    expect(parseCsv('a\tb\n1\t2\n').rows).toEqual([['1', '2']]);
  });
});

describe('parseAmount', () => {
  it.each([
    ['1.234,56', ',', 123456n],
    ['-12,50', ',', -1250n],
    ['12.50', '.', 1250n],
    ['-53.060000', '.', -5306n],
    ['2.100,00', ',', 210000n],
    ['  -7 ', ',', -700n],
    ['', ',', 0n],
  ] as const)('%s (%s) → %s', (value, decimal, expected) => {
    expect(parseAmount(value, decimal)).toBe(expected);
  });
});

describe('parseStatementDate', () => {
  it.each([
    ['01/10/2026', 'dd/MM/yyyy', '2026-10-01'],
    ['01-10-2026', 'dd-MM-yyyy', '2026-10-01'],
    ['01.10.2026', 'dd.MM.yyyy', '2026-10-01'],
    ['2026-10-01', 'yyyy-MM-dd', '2026-10-01'],
    ['2026-10-02T18:31:47.160Z', 'iso', '2026-10-02'],
  ] as const)('%s (%s)', (value, format, day) => {
    expect(parseStatementDate(value, format).toISOString().slice(0, 10)).toBe(day);
  });
});

describe('detectMapping', () => {
  it('finds date, description, amount, decimal and date format in a Spanish statement', () => {
    const parsed = parseCsv(SPANISH);
    expect(detectMapping(parsed)).toMatchObject({
      date: 0,
      description: 2,
      amount: 3,
      decimal: ',',
      dateFormat: 'dd/MM/yyyy',
    });
  });

  it('finds the columns of a Trade Republic export', () => {
    const parsed = parseCsv(TRADE_REPUBLIC);
    expect(detectMapping(parsed)).toMatchObject({
      date: 1,
      description: 5,
      amount: 6,
      decimal: '.',
      dateFormat: 'yyyy-MM-dd',
      currency: 7,
    });
  });
});

describe('toTransactions', () => {
  it('builds signed transactions with distinct hashes for repeated rows', () => {
    const parsed = parseCsv(SPANISH);
    const transactions = toTransactions(parsed, detectMapping(parsed), 'EUR');
    expect(transactions.map((t) => t.amount)).toEqual([-90000n, -4530n, -4530n, 210000n]);
    expect(transactions[1]!.description).toBe('MERCADONA VALENCIA');
    expect(new Set(transactions.map((t) => t.hash)).size).toBe(4);
  });

  it('gives the same hashes when the same file is imported again', () => {
    const parsed = parseCsv(SPANISH);
    const once = toTransactions(parsed, detectMapping(parsed), 'EUR').map((t) => t.hash);
    const twice = toTransactions(parsed, detectMapping(parsed), 'EUR').map((t) => t.hash);
    expect(twice).toEqual(once);
  });

  it('combines separate debit and credit columns', () => {
    const parsed = parseCsv(
      'Fecha;Concepto;Cargo;Abono\n01/10/2026;Luz;55,20;\n02/10/2026;Bizum;;10,00\n',
    );
    const mapping = detectMapping(parsed);
    expect(mapping).toMatchObject({ debit: 2, credit: 3, amount: null });
    expect(toTransactions(parsed, mapping, 'EUR').map((t) => t.amount)).toEqual([-5520n, 1000n]);
  });

  it('skips rows without a valid date', () => {
    const parsed = parseCsv('Fecha;Concepto;Importe\n01/10/2026;Luz;-5,00\nTotal;;-5,00\n');
    expect(toTransactions(parsed, detectMapping(parsed), 'EUR')).toHaveLength(1);
  });
});
