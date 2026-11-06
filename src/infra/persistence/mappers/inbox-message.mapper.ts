import { InboxMessage } from '../../../domain/messaging/inbox-message';
import { InboxMessageEntity } from '../entities/inbox-message.entity';

export class InboxMessageMapper {
  static toEntity(msg: InboxMessage): InboxMessageEntity {
    const entity = new InboxMessageEntity();
    entity.consumerName = msg.consumerName;
    entity.messageId = msg.messageId;
    entity.payloadHash = msg.payloadHash;
    entity.receivedAt = msg.receivedAt;
    entity.processedAt = msg.processedAt;
    return entity;
  }

  static toDomain(entity: InboxMessageEntity): InboxMessage {
    return InboxMessage.rehydrate({
      consumerName: entity.consumerName,
      messageId: entity.messageId,
      payloadHash: entity.payloadHash,
      receivedAt: entity.receivedAt,
      processedAt: entity.processedAt,
    });
  }
}