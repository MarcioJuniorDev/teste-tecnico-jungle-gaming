import { MoneyProps } from '../../../domain/money/money';
import { WagerTransactionKind } from '../../../domain/wagering/wager-transaction-kind';

export interface InboxContext {
  consumerName: string;
  messageId: string;
}

export interface ProcessWagerTransactionCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  inbox?: InboxContext;
  correlationId: string;
}