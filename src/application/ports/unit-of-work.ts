import type { EntityManager } from '@mikro-orm/postgresql';
import type { WalletRepository } from './wallet.repository';
import type { WagerTransactionRepository } from './wager-transaction.repository';
import type { InboxRepository } from './inbox.repository';
import type { OutboxRepository } from './outbox.repository';
import type { LedgerRepository } from './ledger.repository';

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export interface TransactionalRepositories {
  wallets: WalletRepository;
  transactions: WagerTransactionRepository;
  inbox: InboxRepository;
  outbox: OutboxRepository;
  ledger: LedgerRepository;
}

export interface UnitOfWork {
  run<T>(
    fn: (repos: TransactionalRepositories, em: EntityManager) => Promise<T>,
  ): Promise<T>;
}