import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/domain/money/money';
import { LedgerDirection } from '../../src/domain/ledger/ledger-direction';
import { FailureCode } from '../../src/domain/wagering/failure-code';
import { WagerTransaction } from '../../src/domain/wagering/wager-transaction';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction-kind';
import { WagerTransactionStatus } from '../../src/domain/wagering/wager-transaction-status';
import { InvalidTransactionStateError } from '../../src/domain/shared/invalid-transaction-state-error';

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

describe('WagerTransaction', () => {
  test('create rejects OPENING from external entry points', () => {
    expect(() =>
      WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Opening }),
    ).toThrow();
  });

  test('create requires reference for REFUND and ROLLBACK', () => {
    expect(() =>
      WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Refund }),
    ).toThrow();
    expect(() =>
      WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Rollback }),
    ).toThrow();
  });

  test('create starts in PENDING', () => {
    const tx = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.isTerminal()).toBe(false);
  });

  test('PENDING -> PROCESSED is allowed and becomes terminal', () => {
    const tx = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    tx.markProcessed(undefined, new Date());
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);
    expect(tx.processedAt).toBeInstanceOf(Date);
  });

  test('PENDING -> PENDING_REFERENCE is allowed', () => {
    const tx = WagerTransaction.create({
      ...baseProps,
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-0',
    });
    tx.markPendingReference();
    expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
  });

  test('terminal state rejects further transitions', () => {
    const tx = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    tx.reject(FailureCode.InsufficientFunds);
    expect(() => tx.markProcessed(undefined, new Date())).toThrow(InvalidTransactionStateError);
    expect(() => tx.reject(FailureCode.InternalError)).toThrow(InvalidTransactionStateError);
    expect(() => tx.fail(FailureCode.InternalError)).toThrow(InvalidTransactionStateError);
  });

  test('affectsBalance is false only for LOSS', () => {
    const loss = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Loss });
    const bet = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    expect(loss.affectsBalance()).toBe(false);
    expect(bet.affectsBalance()).toBe(true);
  });

  test('requiresReference is true for REFUND and ROLLBACK', () => {
    const refund = WagerTransaction.create({
      ...baseProps,
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-0',
    });
    const bet = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    expect(refund.requiresReference()).toBe(true);
    expect(bet.requiresReference()).toBe(false);
  });

  test('ledgerDirectionFor returns DEBIT for BET and CREDIT for WIN/REFUND', () => {
    const bet = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    const win = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Win });
    const refund = WagerTransaction.create({
      ...baseProps,
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-0',
    });
    expect(bet.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    expect(win.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    expect(refund.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  test('ROLLBACK inverts the reference direction', () => {
    const bet = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    const rollback = WagerTransaction.create({
      ...baseProps,
      id: 't2',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: 'ext-1',
    });
    expect(rollback.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
  });

  test('LOSS has no ledger direction', () => {
    const loss = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Loss });
    expect(() => loss.ledgerDirectionFor()).toThrow();
  });

  test('matchesPayload compares the hash', () => {
    const tx = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet });
    expect(tx.matchesPayload('hash-1')).toBe(true);
    expect(tx.matchesPayload('other')).toBe(false);
  });

  test('rehydrate does not revalidate and restores state', () => {
    const tx = WagerTransaction.rehydrate({
      ...baseProps,
      referenceExternalTransactionId: undefined,
      createdAt: new Date('2020-01-01'),
      status: WagerTransactionStatus.Rejected,
      failureCode: FailureCode.InsufficientFunds,
      processedAt: new Date('2020-01-02'),
      kind: WagerTransactionKind.Bet,
    });
    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(tx.isTerminal()).toBe(true);
  });
});