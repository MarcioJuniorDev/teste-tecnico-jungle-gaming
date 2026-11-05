import { MoneyProps } from '../../money/money';
import { IntegrationEvent } from '../../messaging/integration-event';
import { EventContext } from '../event-context';
import { FailureCode } from '../failure-code';
import { WagerTransaction } from '../wager-transaction';
import { WagerTransactionKind } from '../wager-transaction-kind';

export interface WagerTransactionRejectedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  failureCode: FailureCode;
  rejectedAt: string;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(
    transaction: WagerTransaction,
    failureCode: FailureCode,
    ctx: EventContext,
  ): WagerTransactionRejected {
    return new WagerTransactionRejected({
      eventId: ctx.eventId,
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt ?? new Date(),
      data: {
        transactionId: transaction.id,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        kind: transaction.kind,
        money: transaction.money.toJSON(),
        failureCode,
        rejectedAt: (transaction.processedAt ?? new Date()).toISOString(),
      },
    });
  }
}