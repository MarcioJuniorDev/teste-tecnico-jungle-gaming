import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/domain/money/money';
import { InvalidMoneyError } from '../../src/domain/shared/invalid-money-error';

describe('Money', () => {
  test('from accepts valid decimal strings and normalizes to 2 places', () => {
    expect(Money.from({ amount: '25', currency: 'BRL' }).toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(Money.from({ amount: '25.5', currency: 'BRL' }).toJSON()).toEqual({ amount: '25.50', currency: 'BRL' });
    expect(Money.from({ amount: '25.50', currency: 'BRL' }).toJSON()).toEqual({ amount: '25.50', currency: 'BRL' });
  });

  test('from rejects invalid amounts', () => {
    const invalid = ['', 'NaN', 'Infinity', '1e3', '-1.00', '1.234', 'abc', '1,00'];
    for (const amount of invalid) {
      expect(() => Money.from({ amount, currency: 'BRL' })).toThrow(InvalidMoneyError);
    }
  });

  test('from rejects invalid currency', () => {
    expect(() => Money.from({ amount: '1.00', currency: 'brl' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: '1.00', currency: 'BR' })).toThrow(InvalidMoneyError);
  });

  test('add and subtract return new instances', () => {
    const a = Money.from({ amount: '10.00', currency: 'BRL' });
    const b = Money.from({ amount: '2.50', currency: 'BRL' });
    expect(a.add(b).toJSON()).toEqual({ amount: '12.50', currency: 'BRL' });
    expect(a.subtract(b).toJSON()).toEqual({ amount: '7.50', currency: 'BRL' });
    expect(a.toJSON()).toEqual({ amount: '10.00', currency: 'BRL' });
  });

  test('operations across currencies throw', () => {
    const brl = Money.from({ amount: '1.00', currency: 'BRL' });
    const usd = Money.from({ amount: '1.00', currency: 'USD' });
    expect(() => brl.add(usd)).toThrow(InvalidMoneyError);
    expect(() => brl.subtract(usd)).toThrow(InvalidMoneyError);
    expect(() => brl.isLessThan(usd)).toThrow(InvalidMoneyError);
  });

  test('equals compares value and currency', () => {
    const a = Money.from({ amount: '1.00', currency: 'BRL' });
    const b = Money.from({ amount: '1.0', currency: 'BRL' });
    const c = Money.from({ amount: '1.00', currency: 'USD' });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});