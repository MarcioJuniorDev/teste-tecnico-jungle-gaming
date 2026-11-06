import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { InboxRepository } from '../../../application/ports/inbox.repository';
import { InboxMessage } from '../../../domain/messaging/inbox-message';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { InboxMessageMapper } from '../mappers/inbox-message.mapper';

@Injectable()
export class MikroOrmInboxRepository implements InboxRepository {
  constructor(private readonly em: EntityManager) {}

  async findByConsumerAndMessage(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null> {
    const entity = await this.em.findOne(InboxMessageEntity, {
      consumerName,
      messageId,
    });
    return entity ? InboxMessageMapper.toDomain(entity) : null;
  }

  async save(message: InboxMessage): Promise<void> {
    const entity = InboxMessageMapper.toEntity(message);
    this.em.persist(entity);
    await this.em.flush();
  }
}