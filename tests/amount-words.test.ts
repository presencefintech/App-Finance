import { describe, expect, it } from 'vitest';
import { amountInWords } from '../src/lib/amount-words';

describe('montant en lettres (français, USD / CDF)', () => {
  const usd: [string, string][] = [
    ['0', 'zéro dollar américain'],
    ['1', 'un dollar américain'],
    ['2', 'deux dollars américains'],
    ['21', 'vingt et un dollars américains'],
    ['71', 'soixante et onze dollars américains'],
    ['80', 'quatre-vingts dollars américains'],
    ['81', 'quatre-vingt-un dollars américains'],
    ['100', 'cent dollars américains'],
    ['200', 'deux cents dollars américains'],
    ['1000', 'mille dollars américains'],
    ['2000', 'deux mille dollars américains'],
    ['1250', 'mille deux cent cinquante dollars américains'],
    ['2000000', 'deux millions de dollars américains'],
    ['1000000', 'un million de dollars américains'],
    ['2000001', 'deux millions un dollars américains'],
    ['1000000000', 'un milliard de dollars américains'],
  ];
  it.each(usd)('USD %s', (value, expected) => expect(amountInWords(value, 'USD')).toBe(expected));

  const cdf: [string, string][] = [
    ['500000', 'cinq cent mille francs congolais'],
    ['2500000', 'deux millions cinq cent mille francs congolais'],
    ['1', 'un franc congolais'],
    ['80', 'quatre-vingts francs congolais'],
  ];
  it.each(cdf)('CDF %s', (value, expected) => expect(amountInWords(value, 'CDF')).toBe(expected));

  it('centimes', () => {
    expect(amountInWords('2000.50', 'USD')).toBe('deux mille dollars américains et cinquante cents');
    expect(amountInWords('1.01', 'USD')).toBe('un dollar américain et un cent');
    expect(amountInWords('0.05', 'USD')).toBe('zéro dollar américain et cinq cents');
    expect(amountInWords('10.5', 'CDF')).toBe('dix francs congolais et cinquante centimes');
    expect(amountInWords('0.01', 'CDF')).toBe('zéro franc congolais et un centime');
    expect(amountInWords('99.99', 'USD')).toBe('quatre-vingt-dix-neuf dollars américains et quatre-vingt-dix-neuf cents');
  });

  it('un montant de plusieurs millions de millions reste exact (pas de passage par number)', () => {
    expect(amountInWords('9007199254740993', 'USD')).toMatch(/neuf cent quatre-vingt-treize dollars américains$/); // 2^53 + 1 : un number aurait perdu le dernier chiffre
  });

  it('refuse les entrées invalides', () => {
    for (const bad of ['', 'abc', '1,5', '1.234', '1e5']) expect(() => amountInWords(bad, 'USD')).toThrow();
  });
});
