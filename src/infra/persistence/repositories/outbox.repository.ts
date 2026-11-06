import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
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

  async save(message: OutboxMessage): Promise<void> {
    const entity = OutboxMessageMapper.toEntity(message);
    this.em.persist(entity);
    await this.em.flush();
  }
}