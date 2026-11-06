import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import config from '../../../mikro-orm.config';

import { LEDGER_REPOSITORY } from '../../application/ports/ledger.repository';
import { INBOX_REPOSITORY } from '../../application/ports/inbox.repository';
import { OUTBOX_REPOSITORY } from '../../application/ports/outbox.repository';
import { UNIT_OF_WORK } from '../../application/ports/unit-of-work';
import { WAGER_TRANSACTION_REPOSITORY } from '../../application/ports/wager-transaction.repository';
import { WALLET_REPOSITORY } from '../../application/ports/wallet.repository';

import { MikroOrmInboxRepository } from './repositories/inbox.repository';
import { MikroOrmLedgerRepository } from './repositories/ledger.repository';
import { MikroOrmOutboxRepository } from './repositories/outbox.repository';
import { MikroOrmUnitOfWork } from './repositories/unit-of-work';
import { MikroOrmWagerTransactionRepository } from './repositories/wager-transaction.repository';
import { MikroOrmWalletRepository } from './repositories/wallet.repository';

import { ProcessWagerTransactionUseCase } from '../../application/use-cases/process-wager-transaction/process-wager-transaction.use-case';

const REPOSITORY_PROVIDERS = [
  { provide: WALLET_REPOSITORY, useClass: MikroOrmWalletRepository },
  { provide: WAGER_TRANSACTION_REPOSITORY, useClass: MikroOrmWagerTransactionRepository },
  { provide: INBOX_REPOSITORY, useClass: MikroOrmInboxRepository },
  { provide: OUTBOX_REPOSITORY, useClass: MikroOrmOutboxRepository },
  { provide: UNIT_OF_WORK, useClass: MikroOrmUnitOfWork },
  { provide: LEDGER_REPOSITORY, useClass: MikroOrmLedgerRepository },
];

const USE_CASE_PROVIDERS = [ProcessWagerTransactionUseCase];

@Module({
  imports: [MikroOrmModule.forRoot(config)],
  providers: [...REPOSITORY_PROVIDERS, ...USE_CASE_PROVIDERS],
  exports: [...REPOSITORY_PROVIDERS, ...USE_CASE_PROVIDERS],
})
export class PersistenceModule {}