import {
  Entity,
  PrimaryKey,
  Property,
  Embedded,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { MoneyEmbeddable } from './money.embeddable';

@Entity({ tableName: 'wallet_ledger_entries' })
@Unique({ properties: ['transactionId', 'walletId'] })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid', fieldName: 'wallet_id' })
  walletId!: string;

  @Property({ type: 'uuid', fieldName: 'transaction_id' })
  transactionId!: string;

  @Property({ type: 'string', length: 10, columnType: 'varchar(10)' })
  direction!: 'DEBIT' | 'CREDIT';

  @Embedded(() => MoneyEmbeddable, { prefix: 'money_' })
  money!: MoneyEmbeddable;

  @Embedded(() => MoneyEmbeddable, { prefix: 'balance_before_' })
  balanceBefore!: MoneyEmbeddable;

  @Embedded(() => MoneyEmbeddable, { prefix: 'balance_after_' })
  balanceAfter!: MoneyEmbeddable;

  @Property({ type: 'timestamptz', fieldName: 'created_at' })
  createdAt!: Date;
}