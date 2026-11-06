import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
  Embedded,
} from '@mikro-orm/decorators/legacy';
import { MoneyEmbeddable } from './money.embeddable';

@Entity({ tableName: 'wallets' })
@Unique({ properties: ['playerId', 'currency'] })
export class WalletEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid', fieldName: 'player_id' })
  playerId!: string;

  @Property({ type: 'string', length: 3, columnType: 'char(3)' })
  currency!: string;

  @Embedded(() => MoneyEmbeddable, { prefix: 'balance_' })
  balance!: MoneyEmbeddable;

  @Property({ type: 'integer', default: 1 })
  version: number = 1;

  @Property({ type: 'timestamptz', fieldName: 'created_at' })
  createdAt!: Date;

  @Property({ type: 'timestamptz', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt!: Date;
}