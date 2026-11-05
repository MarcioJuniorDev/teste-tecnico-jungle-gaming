import { Money } from '../money/money';
import { WalletLedgerEntry } from '../ledger/wallet-ledger-entry';
import { LedgerDirection } from '../ledger/ledger-direction';
import { DomainError } from '../shared/domain-error';
import { InvalidMoneyError } from '../shared/invalid-money-error';
import { WalletState } from './wallet-state';

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
}

export interface MovementResult {
  entry: WalletLedgerEntry;
  wallet: Wallet;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): Wallet {
    if (!props.id) throw new DomainError('wallet id is required');
    if (!props.playerId) throw new DomainError('playerId is required');
    if (props.initialBalance.isNegative()) {
      throw new InvalidMoneyError('initialBalance cannot be negative');
    }
    const now = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(
    transactionId: string,
    money: Money,
    entryId: string,
  ): MovementResult {
    this.assertSameCurrency(money);
    if (!money.isPositive()) {
      throw new InvalidMoneyError('debit amount must be positive');
    }
    if (this._balance.isLessThan(money)) {
      throw new DomainError('insufficient funds');
    }
    return this.applyMovement(transactionId, money, LedgerDirection.Debit, entryId);
  }

  credit(
    transactionId: string,
    money: Money,
    entryId: string,
  ): MovementResult {
    this.assertSameCurrency(money);
    if (!money.isPositive()) {
      throw new InvalidMoneyError('credit amount must be positive');
    }
    return this.applyMovement(transactionId, money, LedgerDirection.Credit, entryId);
  }

  private applyMovement(
    transactionId: string,
    money: Money,
    direction: LedgerDirection,
    entryId: string,
  ): MovementResult {
    const balanceBefore = this._balance;
    const balanceAfter =
      direction === LedgerDirection.Credit
        ? balanceBefore.add(money)
        : balanceBefore.subtract(money);
    const now = new Date();
    const entry = WalletLedgerEntry.create({
      id: entryId,
      walletId: this.id,
      transactionId,
      direction,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: now,
    });
    const updated = new Wallet(
      this.id,
      this.playerId,
      this.currency,
      balanceAfter,
      this._version + 1,
      this.createdAt,
      now,
    );
    return { entry, wallet: updated };
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new InvalidMoneyError(
        `currency mismatch: wallet ${this.currency} vs operation ${money.currency}`,
      );
    }
  }
}