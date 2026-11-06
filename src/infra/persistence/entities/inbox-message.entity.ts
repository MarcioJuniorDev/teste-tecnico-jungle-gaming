import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'inbox_messages' })
export class InboxMessageEntity {
  @PrimaryKey({ type: 'string', length: 128, fieldName: 'consumer_name' })
  consumerName!: string;

  @PrimaryKey({ type: 'string', length: 128, fieldName: 'message_id' })
  messageId!: string;

  @Property({ type: 'string', length: 64, fieldName: 'payload_hash' })
  payloadHash!: string;

  @Property({ type: 'timestamptz', fieldName: 'received_at' })
  receivedAt!: Date;

  @Property({ type: 'timestamptz', fieldName: 'processed_at', nullable: true })
  processedAt?: Date;
}