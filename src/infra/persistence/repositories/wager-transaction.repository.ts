import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransactionRepository } from '../../../application/ports/wager-transaction.repository';
import { WagerTransaction } from '../../../domain/wagering/wager-transaction';
import { WagerTransactionKind } from '../../../domain/wagering/wager-transaction-kind';
import { WagerTransactionStatus } from '../../../domain/wagering/wager-transaction-status';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';
import { WagerTransactionMapper } from '../mappers/wager-transaction.mapper';

@Injectable()
export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { id });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId,
    });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      idempotencyKey,
    });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findProcessedReversalFor(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      referenceTransactionId,
      kind,
      status: WagerTransactionStatus.Processed,
    });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async save(transaction: WagerTransaction): Promise<void> {
    const entity = WagerTransactionMapper.toEntity(transaction);
    const managed = await this.em.findOne(WagerTransactionEntity, { id: transaction.id });
    if (managed) {
      this.em.assign(managed, entity, { mergeObjectProperties: true });
    } else {
      this.em.persist(entity);
    }
    await this.em.flush();
  }

   async incrementAttempts(id: string, nextAttemptAt: Date): Promise<void> {
    await this.em.execute(
      'update wager_transactions set attempts = attempts + 1, next_attempt_at = ? where id = ?',
      [nextAttemptAt, id],
    );
  }
}