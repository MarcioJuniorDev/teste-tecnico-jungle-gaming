import { MoneyProps } from '../../money/money';
import { IntegrationEvent } from '../../messaging/integration-event';
import { EventContext } from '../event-context';
import { WagerTransaction } from '../wager-transaction';
import { WagerTransactionKind } from '../wager-transaction-kind';

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  referenceExternalTransactionId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  pendingSince: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(
    transaction: WagerTransaction,
    ctx: EventContext,
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference({
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
        referenceExternalTransactionId:
          transaction.referenceExternalTransactionId ?? '',
        kind: transaction.kind,
        money: transaction.money.toJSON(),
        pendingSince: transaction.createdAt.toISOString(),
      },
    });
  }
}