import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
  Embedded,
  Index,
} from '@mikro-orm/decorators/legacy';
import { MoneyEmbeddable } from './money.embeddable';

@Entity({ tableName: 'wager_transactions' })
@Unique({ properties: ['providerId', 'idempotencyKey'] })
@Unique({ properties: ['providerId', 'externalTransactionId'] })
@Index({ properties: ['status', 'nextAttemptAt'] })
export class WagerTransactionEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'string', length: 64, fieldName: 'provider_id' })
  providerId!: string;

  @Property({ type: 'string', length: 128, fieldName: 'external_transaction_id' })
  externalTransactionId!: string;

  @Property({ type: 'string', length: 200, fieldName: 'idempotency_key' })
  idempotencyKey!: string;

  @Property({ type: 'string', length: 64, fieldName: 'payload_hash' })
  payloadHash!: string;

  @Property({ type: 'uuid', fieldName: 'wallet_id' })
  walletId!: string;

  @Property({ type: 'uuid', fieldName: 'player_id' })
  playerId!: string;

  @Property({ type: 'string', length: 128, fieldName: 'round_id' })
  roundId!: string;

  @Property({ type: 'string', length: 128, fieldName: 'game_id' })
  gameId!: string;

  @Property({ type: 'string', length: 16 })
  kind!: 'OPENING' | 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';

  @Embedded(() => MoneyEmbeddable, { prefix: 'money_' })
  money!: MoneyEmbeddable;

  @Property({
    type: 'string',
    length: 128,
    fieldName: 'reference_external_transaction_id',
    nullable: true,
  })
  referenceExternalTransactionId?: string;

  @Property({ type: 'uuid', fieldName: 'reference_transaction_id', nullable: true })
  referenceTransactionId?: string;

  @Property({ type: 'string', length: 20 })
  status!: 'PENDING' | 'PENDING_REFERENCE' | 'PROCESSED' | 'REJECTED' | 'FAILED';

  @Property({ type: 'string', length: 32, fieldName: 'failure_code', nullable: true })
  failureCode?: string;

  @Property({ type: 'timestamptz', fieldName: 'created_at' })
  createdAt!: Date;

  @Property({ type: 'timestamptz', fieldName: 'processed_at', nullable: true })
  processedAt?: Date;

  @Property({ type: 'timestamptz', fieldName: 'next_attempt_at', nullable: true })
  nextAttemptAt?: Date;

  @Property({ type: 'integer', default: 0, fieldName: 'attempts' })
  attempts: number = 0;
}