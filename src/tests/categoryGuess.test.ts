import { guessCategory, matchRule, normalizeMerchant } from '~/lib/categoryGuess';

describe('guessCategory', () => {
  it.each([
    ['RECIBO ALQUILER PISO', 'rent'],
    ['IBERDROLA CLIENTES', 'electricity'],
    ['COMPRA MERCADONA VALENCIA', 'groceries'],
    ['REPSOL E.S. 1234', 'fuel'],
    ['NETFLIX.COM', 'movies'],
    ['TRANSFERENCIA A JUAN', null],
  ])('%s → %s', (text, category) => {
    expect(guessCategory(text)).toBe(category);
  });
});

describe('normalizeMerchant', () => {
  it('drops card and date noise so similar charges share a pattern', () => {
    expect(normalizeMerchant('COMPRA TARJ. 1234 MERCADONA VALENCIA 03/10')).toBe(
      'mercadona valencia',
    );
  });
});

describe('matchRule', () => {
  const rules = [
    { pattern: 'mercadona', action: 'SHARED' as const, category: 'groceries' },
    { pattern: 'mercadona valencia', action: 'PERSONAL' as const, category: 'groceries' },
    { pattern: 'netflix', action: 'IGNORED' as const, category: null },
  ];

  it('prefers the longest matching pattern', () => {
    expect(matchRule(rules, 'COMPRA MERCADONA VALENCIA')?.action).toBe('PERSONAL');
    expect(matchRule(rules, 'MERCADONA MADRID')?.action).toBe('SHARED');
  });

  it('returns null without a match', () => {
    expect(matchRule(rules, 'LIDL')).toBeNull();
  });
});
