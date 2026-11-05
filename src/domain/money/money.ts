import Decimal from 'decimal.js';
import { InvalidMoneyError } from '../shared/invalid-money-error';

export interface MoneyProps {
  amount: string;
  currency: string;
}

const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    const { amount, currency } = props;
    if (typeof amount !== 'string' || typeof currency !== 'string') {
      throw new InvalidMoneyError('amount and currency must be strings');
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new InvalidMoneyError('currency must be an ISO-4217 code (3 uppercase letters)');
    }
    if (!DECIMAL_PATTERN.test(amount)) {
      throw new InvalidMoneyError('amount must be a decimal string with at most 2 decimal places');
    }
    const decimal = new Decimal(amount);
    if (!decimal.isFinite() || decimal.isNaN() || decimal.isNegative()) {
      throw new InvalidMoneyError('amount must be a non-negative finite number');
    }
    if (decimal.decimalPlaces() > 2) {
      throw new InvalidMoneyError('amount must have at most 2 decimal places');
    }
    return new Money(decimal.toDecimalPlaces(2), currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.value.toFixed(2), currency: this.currency };
  }

  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new InvalidMoneyError(`currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}