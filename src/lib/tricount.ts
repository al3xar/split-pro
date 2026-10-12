import { z } from 'zod';

const KEY_REGEX = /^[A-Za-z0-9]{6,64}$/;
const LINK_REGEX = /^(?:https?:\/\/)?(?:www\.)?tricount\.com\/([A-Za-z0-9]{6,64})\/?$/;

/** The public key of a shared Tricount, from its link or the bare key. */
export const parseTricountKey = (input: string): string | null => {
  const value = input.trim();
  if (KEY_REGEX.test(value)) {
    return value;
  }
  return LINK_REGEX.exec(value)?.[1] ?? null;
};

export type TricountEntryType = 'NORMAL' | 'BALANCE' | 'INCOME';

export interface TricountEntry {
  uuid: string;
  type: TricountEntryType;
  description: string;
  date: Date;
  category: string;
  categoryCustom: string;
  payer: string;
  /** Positive, in minor units of the registry currency */
  amount: bigint;
  originalCurrency: string | null;
  originalAmount: string | null;
  allocations: { member: string; amount: bigint }[];
}

export interface ParsedTricount {
  title: string;
  currency: string;
  members: string[];
  entries: TricountEntry[];
}

const membershipSchema = z.object({
  RegistryMembershipNonUser: z.object({ alias: z.object({ display_name: z.string() }) }),
});
const moneySchema = z.object({ value: z.string(), currency: z.string() });
const entrySchema = z.object({
  RegistryEntry: z.object({
    uuid: z.string(),
    type_transaction: z.enum(['NORMAL', 'BALANCE', 'INCOME']),
    description: z.string().nullish(),
    date: z.string(),
    category: z.string().nullish(),
    category_custom: z.string().nullish(),
    amount: moneySchema,
    amount_local: moneySchema.nullish(),
    membership_owned: membershipSchema,
    allocations: z.array(z.object({ membership: membershipSchema, amount: moneySchema })),
  }),
});
const registrySchema = z.object({
  Response: z
    .array(
      z.object({
        Registry: z.object({
          title: z.string(),
          currency: z.string().nullish(),
          memberships: z.array(membershipSchema),
          all_registry_entry: z.array(entrySchema),
        }),
      }),
    )
    .min(1),
});

const fractionDigits = (currency: string) => {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
};

/** "-12.505" → 1251n (absolute value, rounded half up to the currency's minor unit). */
const toMinorUnits = (value: string, digits: number): bigint => {
  const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
  const padded = `${fraction}${'0'.repeat(digits + 1)}`;
  const units = BigInt(`${whole}${padded.slice(0, digits)}`);
  return 5 <= Number(padded[digits] ?? '0') ? units + 1n : units;
};

const memberName = (m: z.infer<typeof membershipSchema>) =>
  m.RegistryMembershipNonUser.alias.display_name;

/** Tricount dates come without a time zone ("2026-10-01 10:00:00.000000"); read them as UTC. */
const parseDate = (value: string) => {
  const iso = value
    .trim()
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1');
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
};

export const parseRegistry = (json: unknown): ParsedTricount => {
  const result = registrySchema.safeParse(json);
  if (!result.success) {
    throw new Error('INVALID_TRICOUNT');
  }
  const registry = result.data.Response[0]!.Registry;
  const firstLocal = registry.all_registry_entry[0]?.RegistryEntry;
  const currency =
    registry.currency ?? firstLocal?.amount_local?.currency ?? firstLocal?.amount.currency ?? 'EUR';
  const digits = fractionDigits(currency);

  const entries = registry.all_registry_entry.map(({ RegistryEntry: e }) => {
    const local = e.amount_local ?? e.amount;
    const amount = toMinorUnits(local.value, digits);
    const originalDiffers = e.amount.currency !== local.currency;
    const rate =
      originalDiffers && 0 !== Number(e.amount.value)
        ? Number(local.value) / Number(e.amount.value)
        : 1;
    const allocations = e.allocations.map((a) => ({
      member: memberName(a.membership),
      amount: toMinorUnits(
        originalDiffers && a.amount.currency === e.amount.currency
          ? String(Number(a.amount.value) * rate)
          : a.amount.value,
        digits,
      ),
    }));
    // Make the shares add up to the total; the rounding difference goes to the last share.
    const difference = amount - allocations.reduce((sum, a) => sum + a.amount, 0n);
    const last = allocations.at(-1);
    if (last && 0n !== difference) {
      last.amount += difference;
    }
    return {
      uuid: e.uuid,
      type: e.type_transaction,
      description: e.description?.trim() ?? '',
      date: parseDate(e.date),
      category: e.category ?? '',
      categoryCustom: e.category_custom ?? '',
      payer: memberName(e.membership_owned),
      amount,
      originalCurrency: originalDiffers ? e.amount.currency : null,
      originalAmount: originalDiffers ? e.amount.value.replace('-', '') : null,
      allocations,
    };
  });

  // People can appear in entries without a membership (e.g. someone who left the tricount).
  const members = [
    ...new Set([
      ...registry.memberships.map(memberName),
      ...entries.flatMap((e) => [e.payer, ...e.allocations.map((a) => a.member)]),
    ]),
  ];

  return { title: registry.title, currency, members, entries };
};

const KEYWORDS: [RegExp, string][] = [
  [/\b(alquiler|rent|renta)\b/, 'rent'],
  [/\bhipoteca|mortgage\b/, 'mortgage'],
  [/\b(luz|electricidad|electricity|iberdrola|endesa)\b/, 'electricity'],
  [/\b(gas|butano|naturgy)\b/, 'gas'],
  [/\b(agua|water)\b/, 'water'],
  [/\b(internet|fibra|wifi|movistar|vodafone|orange|digi)\b/, 'internet'],
  [/\b(movil|telefono|phone)\b/, 'phone'],
  [
    /\b(mercadona|lidl|carrefour|aldi|alcampo|eroski|supermercado|super|compra|groceries)\b/,
    'groceries',
  ],
  [
    /\b(cena|restaurante|restaurant|bar|tapas|almuerzo|desayuno|brunch|pizza|burger|sushi|kebab)\b/,
    'diningOut',
  ],
  [/\b(gasolina|gasoil|diesel|combustible|repsol|cepsa|fuel)\b/, 'fuel'],
  [/\b(taxi|uber|cabify)\b/, 'taxi'],
  [/\b(parking|aparcamiento)\b/, 'parking'],
  [/\b(tren|renfe|train)\b/, 'train'],
  [/\b(vuelo|avion|ryanair|vueling|flight)\b/, 'plane'],
  [/\b(hotel|airbnb|booking)\b/, 'hotel'],
  [/\b(cine|movie|netflix|hbo|disney)\b/, 'movies'],
  [/\b(spotify|concierto|music)\b/, 'music'],
  [/\b(mascota|perro|gato|veterinario|pienso|pets?)\b/, 'pets'],
  [/\b(farmacia|medico|dentista|pharmacy)\b/, 'medical'],
  [/\b(ropa|zara|primark|clothes)\b/, 'clothing'],
  [/\b(regalo|gift)\b/, 'gifts'],
  [/\b(ikea|mueble|furniture)\b/, 'furniture'],
  [/\b(limpieza|cleaning)\b/, 'cleaning'],
];

const ENUMS: Record<string, string> = {
  RESTAURANTS: 'diningOut',
  RESTAURANT: 'diningOut',
  BARS: 'diningOut',
  FOOD_AND_DRINKS: 'groceries',
  FOOD: 'groceries',
  GROCERIES: 'groceries',
  ACCOMMODATION: 'hotel',
  TRANSPORT: 'travel',
  TRANSPORTATION: 'travel',
  ENTERTAINMENT: 'entertainment',
  HEALTH: 'medical',
  HEALTHCARE: 'medical',
  UTILITIES: 'utilities',
  RENT: 'rent',
};

const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** SplitPro category for a Tricount entry: keywords first (more specific), then the enum. */
export const mapTricountCategory = (category: string, custom: string, description: string) => {
  const text = normalize(`${custom} ${description}`);
  const byKeyword = KEYWORDS.find(([regex]) => regex.test(text))?.[1];
  return byKeyword ?? ENUMS[category.toUpperCase()] ?? 'general';
};

export interface TricountExpense {
  paidBy: number;
  name: string;
  category: string;
  amount: bigint;
  splitType: 'EXACT' | 'SETTLEMENT';
  currency: string;
  expenseDate: Date;
  transactionId: string;
  participants: { userId: number; amount: bigint }[];
}

export const tricountTransactionId = (uuid: string) => `tricount:${uuid}`;

export const buildTricountImport = (
  parsed: ParsedTricount,
  memberIds: Record<string, number>,
  existingTransactionIds: Set<string>,
): { expenses: TricountExpense[]; skipped: number } => {
  const fresh = parsed.entries.filter(
    (e) => !existingTransactionIds.has(tricountTransactionId(e.uuid)),
  );

  const expenses = fresh.map((entry): TricountExpense => {
    const paidBy = memberIds[entry.payer]!;
    const sign = 'INCOME' === entry.type ? -1n : 1n;
    const shares = new Map<number, bigint>();
    entry.allocations.forEach((a) => {
      const userId = memberIds[a.member]!;
      shares.set(userId, (shares.get(userId) ?? 0n) + a.amount);
    });
    const total = sign * entry.amount;
    const participants = [
      { userId: paidBy, amount: total - sign * (shares.get(paidBy) ?? 0n) },
      ...[...shares.entries()]
        .filter(([userId]) => userId !== paidBy)
        .map(([userId, share]) => ({ userId, amount: -sign * share })),
    ].filter((p) => 0n !== p.amount);
    const original =
      entry.originalCurrency && entry.originalAmount
        ? ` (${entry.originalAmount} ${entry.originalCurrency})`
        : '';

    return {
      paidBy,
      name: `${entry.description || '—'}${original}`.slice(0, 200),
      category:
        'BALANCE' === entry.type
          ? 'general'
          : mapTricountCategory(entry.category, entry.categoryCustom, entry.description),
      amount: total,
      splitType: 'BALANCE' === entry.type ? 'SETTLEMENT' : 'EXACT',
      currency: parsed.currency,
      expenseDate: entry.date,
      transactionId: tricountTransactionId(entry.uuid),
      participants,
    };
  });

  return { expenses, skipped: parsed.entries.length - fresh.length };
};
