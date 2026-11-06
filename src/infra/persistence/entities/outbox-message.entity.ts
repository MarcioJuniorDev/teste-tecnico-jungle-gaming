import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'outbox_messages' })
@Index({
  name: 'idx_outbox_pending',
  properties: ['nextAttemptAt'],
  where: 'published_at IS NULL',
})
export class OutboxMessageEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid', fieldName: 'aggregate_id' })
  aggregateId!: string;

  @Property({ type: 'string', length: 64, fieldName: 'event_type' })
  eventType!: string;

  @Property({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Property({ type: 'timestamptz', fieldName: 'occurred_at' })
  occurredAt!: Date;

  @Property({ type: 'integer', default: 0 })
  attempts: number = 0;

  @Property({ type: 'timestamptz', fieldName: 'next_attempt_at', nullable: true })
  nextAttemptAt?: Date;

  @Property({ type: 'timestamptz', fieldName: 'published_at', nullable: true })
  publishedAt?: Date;
}