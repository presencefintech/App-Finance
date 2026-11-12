import { describe, expect, it } from 'vitest';
import { formatMoney } from '../src/lib/money';

describe('formatMoney', () => {
  it('formats USD', () => expect(formatMoney('1250.00', 'USD')).toBe('1\u202f250,00 USD'));
  it('formats CDF', () => expect(formatMoney('2500000', 'CDF')).toBe('2\u202f500\u202f000,00 CDF'));
});
