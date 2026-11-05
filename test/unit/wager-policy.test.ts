import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/domain/money/money';
import { FailureCode } from '../../src/domain/wagering/failure-code';
import { WagerTransaction } from '../../src/domain/wagering/wager-transaction';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction-kind';
import { WagerPolicy } from '../../src/domain/wagering/wager-policy';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

const baseProps = {
  id: 't1',
  providerId: 'provider-a',
  externalTransactionId: 'ext-1',
  idempotencyKey: 'provider-a:ext-1',
  payloadHash: 'hash-1',
  walletId: 'w1',
  playerId: 'p1',
  roundId: 'r1',
  gameId: 'g1',
  money: brl('10.00'),
};

const noReversals = { refund: false, rollback: false };

describe('WagerPolicy', () => {
  test('BET with sufficient balance is PROCESS', () => {
    const tx = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    const decision = WagerPolicy.evaluate({
      transaction: tx,
      walletBalance: brl('100.00'),
      reference: null,
      existingReversals: noReversals,
    });
    expect(decision.action).toBe('PROCESS');
  });

  test('BET with insufficient balance is REJECT INSUFFICIENT_FUNDS', () => {
    const tx = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    const decision = WagerPolicy.evaluate({
      transaction: tx,
      walletBalance: brl('5.00'),
      reference: null,
      existingReversals: noReversals,
    });
    expect(decision).toEqual({ action: 'REJECT', failureCode: FailureCode.InsufficientFunds });
  });

  test('WIN without reference is PROCESS', () => {
    const tx = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Win });
    const decision = WagerPolicy.evaluate({
      transaction: tx,
      walletBalance: brl('0.00'),
      reference: null,
      existingReversals: noReversals,
    });
    expect(decision.action).toBe('PROCESS');
  });

  test('LOSS without reference is PROCESS', () => {
    const tx = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Loss });
    const decision = WagerPolicy.evaluate({
      transaction: tx,
      walletBalance: brl('0.00'),
      reference: null,
      existingReversals: noReversals,
    });
    expect(decision.action).toBe('PROCESS');
  });

  test('REFUND without reference is PENDING_REFERENCE', () => {
    const tx = WagerTransaction.create({
      ...baseProps,
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-0',
    });
    const decision = WagerPolicy.evaluate({
      transaction: tx,
      walletBalance: brl('100.00'),
      reference: null,
      existingReversals: noReversals,
    });
    expect(decision.action).toBe('PENDING_REFERENCE');
  });

  test('REFUND referencing BET is PROCESS', () => {
    const bet = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    const refund = WagerTransaction.create({
      ...baseProps,
      id: 't2',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-1',
    });
    const decision = WagerPolicy.evaluate({
      transaction: refund,
      walletBalance: brl('100.00'),
      reference: bet,
      existingReversals: noReversals,
    });
    expect(decision.action).toBe('PROCESS');
  });

  test('REFUND referencing non-BET is REJECT INVALID_REFERENCE_KIND', () => {
    const win = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Win });
    const refund = WagerTransaction.create({
      ...baseProps,
      id: 't2',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-1',
    });
    const decision = WagerPolicy.evaluate({
      transaction: refund,
      walletBalance: brl('100.00'),
      reference: win,
      existingReversals: noReversals,
    });
    expect(decision).toEqual({ action: 'REJECT', failureCode: FailureCode.InvalidReferenceKind });
  });

  test('reference with different provider is REJECT REFERENCE_MISMATCH', () => {
    const otherProviderBet = WagerTransaction.create({
      ...baseProps,
      providerId: 'provider-b',
      kind: WagerTransactionKind.Bet,
    });
    const refund = WagerTransaction.create({
      ...baseProps,
      id: 't2',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-1',
    });
    const decision = WagerPolicy.evaluate({
      transaction: refund,
      walletBalance: brl('100.00'),
      reference: otherProviderBet,
      existingReversals: noReversals,
    });
    expect(decision).toEqual({ action: 'REJECT', failureCode: FailureCode.ReferenceMismatch });
  });

  test('reference with different currency is REJECT CURRENCY_MISMATCH', () => {
    const usdBet = WagerTransaction.create({
      ...baseProps,
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '10.00', currency: 'USD' }),
    });
    const refund = WagerTransaction.create({
      ...baseProps,
      id: 't2',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-1',
    });
    const decision = WagerPolicy.evaluate({
      transaction: refund,
      walletBalance: brl('100.00'),
      reference: usdBet,
      existingReversals: noReversals,
    });
    expect(decision).toEqual({ action: 'REJECT', failureCode: FailureCode.CurrencyMismatch });
  });

  test('REFUND with amount different from reference is REJECT AMOUNT_MISMATCH', () => {
    const bet = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    const refund = WagerTransaction.create({
      ...baseProps,
      id: 't2',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-1',
      money: brl('99.00'),
    });
    const decision = WagerPolicy.evaluate({
      transaction: refund,
      walletBalance: brl('100.00'),
      reference: bet,
      existingReversals: noReversals,
    });
    expect(decision).toEqual({ action: 'REJECT', failureCode: FailureCode.AmountMismatch });
  });

  test('REFUND already reversed is REJECT REFERENCE_ALREADY_REVERSED', () => {
    const bet = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    const refund = WagerTransaction.create({
      ...baseProps,
      id: 't2',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-1',
    });
    const decision = WagerPolicy.evaluate({
      transaction: refund,
      walletBalance: brl('100.00'),
      reference: bet,
      existingReversals: { refund: true, rollback: false },
    });
    expect(decision).toEqual({
      action: 'REJECT',
      failureCode: FailureCode.ReferenceAlreadyReversed,
    });
  });

  test('ROLLBACK of a BET is PROCESS', () => {
    const bet = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    const rollback = WagerTransaction.create({
      ...baseProps,
      id: 't2',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: 'ext-1',
    });
    const decision = WagerPolicy.evaluate({
      transaction: rollback,
      walletBalance: brl('100.00'),
      reference: bet,
      existingReversals: noReversals,
    });
    expect(decision.action).toBe('PROCESS');
  });

  test('ROLLBACK of a LOSS is REJECT INVALID_REFERENCE_KIND', () => {
    const loss = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Loss });
    const rollback = WagerTransaction.create({
      ...baseProps,
      id: 't2',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: 'ext-1',
    });
    const decision = WagerPolicy.evaluate({
      transaction: rollback,
      walletBalance: brl('100.00'),
      reference: loss,
      existingReversals: noReversals,
    });
    expect(decision).toEqual({ action: 'REJECT', failureCode: FailureCode.InvalidReferenceKind });
  });

  test('ROLLBACK that would overdraw is REJECT REVERSAL_WOULD_OVERDRAW', () => {
    const refund = WagerTransaction.create({
      ...baseProps,
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-0',
    });
    const rollback = WagerTransaction.create({
      ...baseProps,
      id: 't2',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: 'ext-1',
    });
    const decision = WagerPolicy.evaluate({
      transaction: rollback,
      walletBalance: brl('5.00'),
      reference: refund,
      existingReversals: noReversals,
    });
    expect(decision).toEqual({
      action: 'REJECT',
      failureCode: FailureCode.ReversalWouldOverdraw,
    });
  });
});