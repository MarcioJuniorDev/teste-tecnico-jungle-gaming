import { MoneyProps } from '../../../domain/money/money';
import { FailureCode } from '../../../domain/wagering/failure-code';
import { WagerTransactionStatus } from '../../../domain/wagering/wager-transaction-status';

export interface ProcessWagerTransactionResult {
  transactionId: string;
  status:
    | WagerTransactionStatus.Processed
    | WagerTransactionStatus.Rejected
    | WagerTransactionStatus.PendingReference;
  idempotentReplay: boolean;
  balance?: MoneyProps;
  failureCode?: FailureCode;
}