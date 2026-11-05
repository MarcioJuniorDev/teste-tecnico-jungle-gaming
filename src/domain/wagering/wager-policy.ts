import { LedgerDirection } from '../ledger/ledger-direction';
import { Money } from '../money/money';
import { FailureCode } from './failure-code';
import { WagerTransaction } from './wager-transaction';
import { WagerTransactionKind } from './wager-transaction-kind';

export type PolicyDecision =
  | { readonly action: 'PROCESS' }
  | { readonly action: 'REJECT'; readonly failureCode: FailureCode }
  | { readonly action: 'PENDING_REFERENCE' };

export interface PolicyInput {
  transaction: WagerTransaction;
  walletBalance: Money;
  reference: WagerTransaction | null;
  /**
   * Transações PROCESSED que já reverteram a referência,
   * separadas por tipo de reversão (REFUND ou ROLLBACK).
   */
  existingReversals: {
    refund: boolean;
    rollback: boolean;
  };
}

export class WagerPolicy {
  static evaluate(input: PolicyInput): PolicyDecision {
    const { transaction, walletBalance, reference, existingReversals } = input;

    if (transaction.requiresReference()) {
      if (!reference) {
        return { action: 'PENDING_REFERENCE' };
      }
      const referenceCheck = this.checkReference(transaction, reference, existingReversals);
      if (referenceCheck) {
        return referenceCheck;
      }
      return this.evaluateReversalBalance(transaction, walletBalance, reference);
    }

    if (transaction.kind === WagerTransactionKind.Bet) {
      if (walletBalance.isLessThan(transaction.money)) {
        return { action: 'REJECT', failureCode: FailureCode.InsufficientFunds };
      }
      return { action: 'PROCESS' };
    }

    return { action: 'PROCESS' };
  }

  private static checkReference(
    transaction: WagerTransaction,
    reference: WagerTransaction,
    existingReversals: PolicyInput['existingReversals'],
  ): PolicyDecision | null {
    if (
      reference.providerId !== transaction.providerId ||
      reference.playerId !== transaction.playerId ||
      reference.walletId !== transaction.walletId ||
      reference.roundId !== transaction.roundId
    ) {
      return { action: 'REJECT', failureCode: FailureCode.ReferenceMismatch };
    }

    if (reference.money.currency !== transaction.money.currency) {
      return { action: 'REJECT', failureCode: FailureCode.CurrencyMismatch };
    }

    if (transaction.kind === WagerTransactionKind.Refund) {
      if (reference.kind !== WagerTransactionKind.Bet) {
        return { action: 'REJECT', failureCode: FailureCode.InvalidReferenceKind };
      }
      if (existingReversals.refund) {
        return { action: 'REJECT', failureCode: FailureCode.ReferenceAlreadyReversed };
      }
    }

    if (transaction.kind === WagerTransactionKind.Rollback) {
      if (
        reference.kind !== WagerTransactionKind.Bet &&
        reference.kind !== WagerTransactionKind.Win &&
        reference.kind !== WagerTransactionKind.Refund
      ) {
        return { action: 'REJECT', failureCode: FailureCode.InvalidReferenceKind };
      }
      if (existingReversals.rollback) {
        return { action: 'REJECT', failureCode: FailureCode.ReferenceAlreadyReversed };
      }
    }

    if (!reference.money.equals(transaction.money)) {
      return { action: 'REJECT', failureCode: FailureCode.AmountMismatch };
    }

    return null;
  }

  private static evaluateReversalBalance(
    transaction: WagerTransaction,
    walletBalance: Money,
    reference: WagerTransaction,
  ): PolicyDecision {
    const direction = transaction.ledgerDirectionFor(reference);
    if (direction === LedgerDirection.Debit && walletBalance.isLessThan(transaction.money)) {
      return { action: 'REJECT', failureCode: FailureCode.ReversalWouldOverdraw };
    }
    return { action: 'PROCESS' };
  }
}