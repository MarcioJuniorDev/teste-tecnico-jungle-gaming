import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import config from '../../../mikro-orm.config';
import {
  WALLET_REPOSITORY,
} from '../../application/ports/wallet.repository';
import {
  WAGER_TRANSACTION_REPOSITORY,
} from '../../application/ports/wager-transaction.repository';
import {
  INBOX_REPOSITORY,
} from '../../application/ports/inbox.repository';
import {
  OUTBOX_REPOSITORY,
} from '../../application/ports/outbox.repository';
import {
  UNIT_OF_WORK,
} from '../../application/ports/unit-of-work';
import { MikroOrmWalletRepository } from './repositories/wallet.repository';
import { MikroOrmWagerTransactionRepository } from './repositories/wager-transaction.repository';
import { MikroOrmInboxRepository } from './repositories/inbox.repository';
import { MikroOrmOutboxRepository } from './repositories/outbox.repository';
import { MikroOrmUnitOfWork } from './repositories/unit-of-work';

const REPOSITORY_PROVIDERS = [
  { provide: WALLET_REPOSITORY, useClass: MikroOrmWalletRepository },
  { provide: WAGER_TRANSACTION_REPOSITORY, useClass: MikroOrmWagerTransactionRepository },
  { provide: INBOX_REPOSITORY, useClass: MikroOrmInboxRepository },
  { provide: OUTBOX_REPOSITORY, useClass: MikroOrmOutboxRepository },
  { provide: UNIT_OF_WORK, useClass: MikroOrmUnitOfWork },
];

@Module({
  imports: [MikroOrmModule.forRoot(config)],
  providers: REPOSITORY_PROVIDERS,
  exports: REPOSITORY_PROVIDERS,
})
export class PersistenceModule {}