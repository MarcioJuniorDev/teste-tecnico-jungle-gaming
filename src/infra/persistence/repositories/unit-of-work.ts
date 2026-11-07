import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  TransactionalRepositories,
  UnitOfWork,
} from '../../../application/ports/unit-of-work';
import { MikroOrmWalletRepository } from './wallet.repository';
import { MikroOrmWagerTransactionRepository } from './wager-transaction.repository';
import { MikroOrmInboxRepository } from './inbox.repository';
import { MikroOrmOutboxRepository } from './outbox.repository';
import { MikroOrmLedgerRepository } from './ledger.repository';

@Injectable()
export class MikroOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly em: EntityManager) {}

  async run<T>(
    fn: (repos: TransactionalRepositories, em: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.em.transactional(async (tx) => {
      const repos: TransactionalRepositories = {
        wallets: new MikroOrmWalletRepository(tx),
        transactions: new MikroOrmWagerTransactionRepository(tx),
        inbox: new MikroOrmInboxRepository(tx),
        outbox: new MikroOrmOutboxRepository(tx),
        ledger: new MikroOrmLedgerRepository(tx),
      };
      return fn(repos, tx);
    });
  }
}