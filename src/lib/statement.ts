/** Bank statement (CSV) parsing. Pure: used by the browser to preview and by the server. */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export type DateFormat = 'dd/MM/yyyy' | 'dd-MM-yyyy' | 'dd.MM.yyyy' | 'yyyy-MM-dd' | 'iso';
export type DecimalSeparator = ',' | '.';

export interface StatementMapping {
  date: number;
  description: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  currency: number | null;
  decimal: DecimalSeparator;
  dateFormat: DateFormat;
}

export interface ParsedTransaction {
  date: Date;
  description: string;
  /** Signed, minor units: negative = money out */
  amount: bigint;
  currency: string;
  /** Stable identity of the row, to skip it when the same statement is imported again */
  hash: string;
}

const DELIMITERS = [';', ',', '\t'] as const;

const countOutsideQuotes = (line: string, delimiter: string) => {
  let inQuotes = false;
  return [...line].filter((char) => {
    if ('"' === char) {
      inQuotes = !inQuotes;
    }
    return !inQuotes && char === delimiter;
  }).length;
};

const splitLine = (line: string, delimiter: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if ('"' === char) {
      if (inQuotes && '"' === line[i + 1]) {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
};

export const parseCsv = (text: string): ParsedCsv => {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => '' !== line.trim());
  const [header = '', ...rest] = lines;
  const delimiter = DELIMITERS.reduce((best, d) =>
    countOutsideQuotes(header, d) > countOutsideQuotes(header, best) ? d : best,
  );
  return {
    headers: splitLine(header, delimiter),
    rows: rest.map((line) => splitLine(line, delimiter)),
  };
};

/** "1.234,56" / "-12,50" / "12.50" / "-53.060000" → minor units (2 decimals, half up). */
export const parseAmount = (value: string, decimal: DecimalSeparator): bigint => {
  const cleaned = value.replace(/[^\d,.\-+]/g, '');
  if ('' === cleaned) {
    return 0n;
  }
  const negative = cleaned.includes('-');
  const normalized =
    ',' === decimal
      ? cleaned.replace(/[.\-+]/g, '').replace(',', '.')
      : cleaned.replace(/[,\-+]/g, '');
  const [whole = '0', fraction = ''] = normalized.split('.');
  const padded = `${fraction}000`;
  const units = BigInt(`${whole || '0'}${padded.slice(0, 2)}`) + (5 <= Number(padded[2]) ? 1n : 0n);
  return negative ? -units : units;
};

const DATE_PATTERNS: Record<Exclude<DateFormat, 'iso'>, RegExp> = {
  'dd/MM/yyyy': /^(\d{1,2})\/(\d{1,2})\/(\d{4})/,
  'dd-MM-yyyy': /^(\d{1,2})-(\d{1,2})-(\d{4})/,
  'dd.MM.yyyy': /^(\d{1,2})\.(\d{1,2})\.(\d{4})/,
  'yyyy-MM-dd': /^(\d{4})-(\d{2})-(\d{2})$/,
};

/** Date-only values become noon UTC so they keep their day in any time zone. */
export const parseStatementDate = (value: string, format: DateFormat): Date => {
  const trimmed = value.trim();
  if ('iso' === format) {
    return new Date(trimmed);
  }
  const match = DATE_PATTERNS[format].exec(trimmed);
  if (!match) {
    return new Date(NaN);
  }
  const [, a, b, c] = match.map(Number) as [number, number, number, number];
  return 'yyyy-MM-dd' === format
    ? new Date(Date.UTC(a, b - 1, c, 12))
    : new Date(Date.UTC(c, b - 1, a, 12));
};

const normalizeHeader = (header: string) =>
  header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const findColumn = (headers: string[], candidates: string[]) => {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const exact = normalized.indexOf(candidate);
    if (-1 !== exact) {
      return exact;
    }
  }
  for (const candidate of candidates) {
    const partial = normalized.findIndex((h) => h.startsWith(candidate));
    if (-1 !== partial) {
      return partial;
    }
  }
  return null;
};

const detectDateFormat = (value: string): DateFormat => {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return 'iso';
  }
  const found = (Object.keys(DATE_PATTERNS) as Exclude<DateFormat, 'iso'>[]).find((f) =>
    DATE_PATTERNS[f].test(value),
  );
  return found ?? 'dd/MM/yyyy';
};

export const detectMapping = ({ headers, rows }: ParsedCsv): StatementMapping => {
  const date =
    findColumn(headers, [
      'fecha operacion',
      'fecha',
      'date',
      'datum',
      'fecha contable',
      'f operacion',
      'fecha valor',
      'datetime',
    ]) ?? 0;
  const description =
    findColumn(headers, [
      'concepto',
      'descripcion',
      'description',
      'name',
      'detalle',
      'movimiento',
      'beneficiario',
      'merchant',
      'payee',
      'texto',
    ]) ?? 1;
  const amount = findColumn(headers, ['importe', 'amount', 'cantidad', 'betrag', 'valor']);
  const debit =
    null === amount ? findColumn(headers, ['cargo', 'debe', 'debit', 'salida', 'gasto']) : null;
  const credit =
    null === amount
      ? findColumn(headers, ['abono', 'haber', 'credit', 'entrada', 'ingreso'])
      : null;
  const currency = findColumn(headers, ['currency', 'divisa', 'moneda']);

  const amountColumns = [amount, debit, credit].filter((c): c is number => null !== c);
  const samples = rows.flatMap((row) => amountColumns.map((c) => row[c] ?? '')).filter(Boolean);
  const decimal: DecimalSeparator = samples.some((v) => /,\d{1,2}$/.test(v.trim())) ? ',' : '.';
  const firstDate = rows.find((row) => row[date])?.[date] ?? '';

  return {
    date,
    description,
    amount,
    debit,
    credit,
    currency,
    decimal,
    dateFormat: detectDateFormat(firstDate),
  };
};

const normalizeDescription = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

export const toTransactions = (
  { rows }: ParsedCsv,
  mapping: StatementMapping,
  defaultCurrency: string,
): ParsedTransaction[] => {
  const seen = new Map<string, number>();
  return rows.flatMap((row) => {
    const date = parseStatementDate(row[mapping.date] ?? '', mapping.dateFormat);
    if (Number.isNaN(date.getTime())) {
      return [];
    }
    const amount =
      null !== mapping.amount
        ? parseAmount(row[mapping.amount] ?? '', mapping.decimal)
        : parseAmount(row[mapping.credit ?? -1] ?? '', mapping.decimal) -
          (() => {
            const debit = parseAmount(row[mapping.debit ?? -1] ?? '', mapping.decimal);
            return 0n > debit ? -debit : debit;
          })();
    const description = (row[mapping.description] ?? '').trim();
    const currency = (null !== mapping.currency ? row[mapping.currency] : '') || defaultCurrency;
    const key = `${date.toISOString().slice(0, 10)}|${amount}|${normalizeDescription(description)}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return [{ date, description, amount, currency, hash: `${key}|${occurrence}` }];
  });
};
