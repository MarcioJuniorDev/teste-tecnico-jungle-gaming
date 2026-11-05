import { MoneyProps } from '../../money/money';
import { IntegrationEvent } from '../../messaging/integration-event';
import { EventContext } from '../event-context';
import { WagerTransaction } from '../wager-transaction';
import { WagerTransactionKind } from '../wager-transaction-kind';

export interface WagerTransactionProcessedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceTransactionId?: string;
  processedAt: string;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
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
        roundId: transaction.roundId,
        kind: transaction.kind,
        money: transaction.money.toJSON(),
        referenceTransactionId: transaction.referenceTransactionId,
        processedAt: (transaction.processedAt ?? new Date()).toISOString(),
      },
    });
  }
}