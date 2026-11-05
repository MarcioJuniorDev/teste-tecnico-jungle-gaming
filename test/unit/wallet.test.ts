import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/domain/money/money';
import { Wallet } from '../../src/domain/wallet/wallet';
import { LedgerDirection } from '../../src/domain/ledger/ledger-direction';
import { InvalidMoneyError } from '../../src/domain/shared/invalid-money-error';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe('Wallet', () => {
  test('open starts at version 1 with the given balance', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('100.00') });
    expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);
  });

  test('debit returns a new wallet with incremented version and a ledger entry', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('100.00') });
    const { wallet: after, entry } = wallet.debit('t1', brl('25.00'), 'e1');
    expect(after.balance.toJSON()).toEqual({ amount: '75.00', currency: 'BRL' });
    expect(after.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.isBalanced()).toBe(true);
    expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
  });

  test('debit rejects when balance would go negative', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('20.00') });
    expect(() => wallet.debit('t1', brl('80.00'), 'e1')).toThrow();
    expect(wallet.balance.toJSON()).toEqual({ amount: '20.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);
  });

  test('credit increases balance and version', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('10.00') });
    const { wallet: after, entry } = wallet.credit('t1', brl('5.00'), 'e1');
    expect(after.balance.toJSON()).toEqual({ amount: '15.00', currency: 'BRL' });
    expect(after.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Credit);
  });

  test('movement with a different currency throws', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('10.00') });
    const usd = Money.from({ amount: '1.00', currency: 'USD' });
    expect(() => wallet.debit('t1', usd, 'e1')).toThrow(InvalidMoneyError);
    expect(() => wallet.credit('t1', usd, 'e1')).toThrow(InvalidMoneyError);
  });

  test('rehydrate restores state without revalidating', () => {
    const wallet = Wallet.rehydrate({
      id: 'w1', playerId: 'p1', currency: 'BRL',
      balance: brl('50.00'), version: 7,
      createdAt: new Date('2020-01-01'), updatedAt: new Date('2020-01-02'),
    });
    expect(wallet.balance.toJSON()).toEqual({ amount: '50.00', currency: 'BRL' });
    expect(wallet.version).toBe(7);
  });
});