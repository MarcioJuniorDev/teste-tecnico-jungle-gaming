import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/domain/money/money';
import { WalletLedgerEntry } from '../../src/domain/ledger/wallet-ledger-entry';
import { LedgerDirection } from '../../src/domain/ledger/ledger-direction';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe('WalletLedgerEntry', () => {
  test('accepts a balanced credit entry', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e1', walletId: 'w1', transactionId: 't1',
      direction: LedgerDirection.Credit,
      money: brl('10.00'),
      balanceBefore: brl('0.00'),
      balanceAfter: brl('10.00'),
      createdAt: new Date(),
    });
    expect(entry.isBalanced()).toBe(true);
  });

  test('accepts a balanced debit entry', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e1', walletId: 'w1', transactionId: 't1',
      direction: LedgerDirection.Debit,
      money: brl('10.00'),
      balanceBefore: brl('20.00'),
      balanceAfter: brl('10.00'),
      createdAt: new Date(),
    });
    expect(entry.isBalanced()).toBe(true);
  });

  test('rejects an unbalanced entry', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'e1', walletId: 'w1', transactionId: 't1',
        direction: LedgerDirection.Credit,
        money: brl('10.00'),
        balanceBefore: brl('0.00'),
        balanceAfter: brl('99.00'),
        createdAt: new Date(),
      }),
    ).toThrow();
  });
});