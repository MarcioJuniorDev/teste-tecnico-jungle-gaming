import { OutboxMessage } from '../../../domain/messaging/outbox-message';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';

export class OutboxMessageMapper {
  static toEntity(msg: OutboxMessage): OutboxMessageEntity {
    const entity = new OutboxMessageEntity();
    entity.id = msg.id;
    entity.aggregateId = msg.aggregateId;
    entity.eventType = msg.eventType;
    entity.payload = msg.payload as Record<string, unknown>;
    entity.occurredAt = msg.occurredAt;
    entity.attempts = msg.attempts;
    entity.nextAttemptAt = msg.nextAttemptAt;
    entity.publishedAt = msg.publishedAt;
    return entity;
  }

  static toDomain(entity: OutboxMessageEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: entity.id,
      aggregateId: entity.aggregateId,
      eventType: entity.eventType,
      payload: entity.payload,
      occurredAt: entity.occurredAt,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt,
      publishedAt: entity.publishedAt,
    });
  }
}