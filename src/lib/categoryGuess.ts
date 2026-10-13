/** Category guessing from free text (bank concepts, Tricount descriptions) and learned rules. */

const KEYWORDS: [RegExp, string][] = [
  [/\b(alquiler|rent|renta)\b/, 'rent'],
  [/\bhipoteca|mortgage\b/, 'mortgage'],
  [/\b(luz|electricidad|electricity|iberdrola|endesa)\b/, 'electricity'],
  [/\b(gas|butano|naturgy)\b/, 'gas'],
  [/\b(agua|water)\b/, 'water'],
  [/\b(internet|fibra|wifi|movistar|vodafone|orange|digi)\b/, 'internet'],
  [/\b(movil|telefono|phone)\b/, 'phone'],
  [/\b(mercadona|lidl|carrefour|aldi|alcampo|eroski|supermercado|super|groceries)\b/, 'groceries'],
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

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** SplitPro category suggested by keywords in the text, or null. */
export const guessCategory = (text: string): string | null =>
  KEYWORDS.find(([regex]) => regex.test(normalize(text)))?.[1] ?? null;

const NOISE = new Set([
  'compra',
  'tarj',
  'tarjeta',
  'pago',
  'en',
  'con',
  'card',
  'payment',
  'transaccion',
  'transaction',
  'contactless',
  'apple',
  'pay',
  'google',
  'recibo',
  'domiciliado',
]);

/** Lowercase merchant text without card/date/number noise, used as a rule pattern. */
export const normalizeMerchant = (text: string) =>
  normalize(text)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => '' !== word && !NOISE.has(word) && !/\d/.test(word))
    .join(' ');

export type RuleAction = 'SHARED' | 'PERSONAL' | 'INCOME' | 'IGNORED';

export interface Rule {
  pattern: string;
  action: string;
  category: string | null;
}

/** The rule whose pattern appears in the text; the longest (most specific) wins. */
export const matchRule = <T extends Rule>(rules: T[], text: string): T | null => {
  const merchant = normalizeMerchant(text);
  return (
    rules
      .filter((rule) => '' !== rule.pattern && merchant.includes(rule.pattern))
      .sort((a, b) => b.pattern.length - a.pattern.length)[0] ?? null
  );
};
