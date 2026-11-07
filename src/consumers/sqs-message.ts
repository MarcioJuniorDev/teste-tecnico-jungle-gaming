import { WagerTransactionKind } from '../domain/wagering/wager-transaction-kind';

export interface SqsWagerTransactionData {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
}

export interface SqsMessage {
  messageId: string;
  type: string;
  occurredAt: string;
  data: SqsWagerTransactionData;
}