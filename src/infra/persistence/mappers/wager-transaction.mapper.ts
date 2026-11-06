import { Money } from '../../../domain/money/money';
import { WagerTransaction } from '../../../domain/wagering/wager-transaction';
import { WagerTransactionKind } from '../../../domain/wagering/wager-transaction-kind';
import { WagerTransactionStatus } from '../../../domain/wagering/wager-transaction-status';
import { FailureCode } from '../../../domain/wagering/failure-code';
import { MoneyEmbeddable } from '../entities/money.embeddable';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';

export class WagerTransactionMapper {
  static toEntity(tx: WagerTransaction): WagerTransactionEntity {
    const entity = new WagerTransactionEntity();
    entity.id = tx.id;
    entity.providerId = tx.providerId;
    entity.externalTransactionId = tx.externalTransactionId;
    entity.idempotencyKey = tx.idempotencyKey;
    entity.payloadHash = tx.payloadHash;
    entity.walletId = tx.walletId;
    entity.playerId = tx.playerId;
    entity.roundId = tx.roundId;
    entity.gameId = tx.gameId;
    entity.kind = tx.kind;
    entity.money = new MoneyEmbeddable(tx.money.toJSON().amount, tx.money.currency);
    entity.referenceExternalTransactionId = tx.referenceExternalTransactionId;
    entity.referenceTransactionId = tx.referenceTransactionId;
    entity.status = tx.status;
    entity.failureCode = tx.failureCode;
    entity.createdAt = tx.createdAt;
    entity.processedAt = tx.processedAt;
    return entity;
  }

  static toDomain(entity: WagerTransactionEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind as WagerTransactionKind,
      money: Money.from({ amount: entity.money.amount, currency: entity.money.currency }),
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      createdAt: entity.createdAt,
      status: entity.status as WagerTransactionStatus,
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: entity.failureCode as FailureCode | undefined,
      processedAt: entity.processedAt,
    });
  }
}