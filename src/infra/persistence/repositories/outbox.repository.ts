import { Injectable } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { OutboxRepository } from '../../../application/ports/outbox.repository';
import { OutboxMessage } from '../../../domain/messaging/outbox-message';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';
import { OutboxMessageMapper } from '../mappers/outbox-message.mapper';

@Injectable()
export class MikroOrmOutboxRepository implements OutboxRepository {
  constructor(private readonly em: EntityManager) {}

  async findPendingDue(now: Date, limit: number): Promise<OutboxMessage[]> {
    const entities = await this.em.find(
      OutboxMessageEntity,
      {
        publishedAt: null,
        $or: [
          { nextAttemptAt: null, occurredAt: { $lte: now } },
          { nextAttemptAt: { $lte: now } },
        ],
      },
      { limit, orderBy: { occurredAt: 'asc' } },
    );
    return entities.map((e) => OutboxMessageMapper.toDomain(e));
  }

  async lockPendingBatch(limit: number): Promise<OutboxMessage[]> {
    const now = new Date();
    const entities = await this.em.find(
      OutboxMessageEntity,
      {
        publishedAt: null,
        $or: [
          { nextAttemptAt: null, occurredAt: { $lte: now } },
          { nextAttemptAt: { $lte: now } },
        ],
      },
      {
        limit,
        orderBy: { occurredAt: 'asc' },
        lockMode: LockMode.PESSIMISTIC_WRITE,
      },
    );
    return entities.map((e) => OutboxMessageMapper.toDomain(e));
  }

  async save(message: OutboxMessage): Promise<void> {
    const entity = OutboxMessageMapper.toEntity(message);
    const managed = await this.em.findOne(OutboxMessageEntity, { id: message.id });
    if (managed) {
      this.em.assign(managed, entity, { mergeObjectProperties: true });
    } else {
      this.em.persist(entity);
    }
    await this.em.flush();
  }

  async markPublished(id: string): Promise<void> {
    await this.em.execute(
      'update outbox_messages set published_at = ? where id = ?',
      [new Date(), id],
    );
  }

  async scheduleRetry(id: string, attempts: number, nextAttemptAt: Date): Promise<void> {
    await this.em.execute(
      'update outbox_messages set attempts = ?, next_attempt_at = ? where id = ?',
      [attempts, nextAttemptAt, id],
    );
  }
}