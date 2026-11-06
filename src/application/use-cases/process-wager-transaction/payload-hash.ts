import { createHash } from 'node:crypto';
import { MoneyProps } from '../../../domain/money/money';
import { WagerTransactionKind } from '../../../domain/wagering/wager-transaction-kind';

export interface PayloadHashInput {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
}

export function computePayloadHash(input: PayloadHashInput): string {
  const canonical = JSON.stringify({
    providerId: input.providerId,
    externalTransactionId: input.externalTransactionId,
    playerId: input.playerId,
    walletId: input.walletId,
    roundId: input.roundId,
    gameId: input.gameId,
    kind: input.kind,
    money: { amount: input.money.amount, currency: input.money.currency },
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}