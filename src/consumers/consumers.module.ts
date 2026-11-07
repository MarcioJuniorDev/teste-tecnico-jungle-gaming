import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import config from '../../mikro-orm.config';
import { WALLET_REPOSITORY } from '../application/ports/wallet.repository';
import { WAGER_TRANSACTION_REPOSITORY } from '../application/ports/wager-transaction.repository';
import { INBOX_REPOSITORY } from '../application/ports/inbox.repository';
import { OUTBOX_REPOSITORY } from '../application/ports/outbox.repository';
import { LEDGER_REPOSITORY } from '../application/ports/ledger.repository';
import { UNIT_OF_WORK } from '../application/ports/unit-of-work';
import { MikroOrmWalletRepository } from '../infra/persistence/repositories/wallet.repository';
import { MikroOrmWagerTransactionRepository } from '../infra/persistence/repositories/wager-transaction.repository';
import { MikroOrmInboxRepository } from '../infra/persistence/repositories/inbox.repository';
import { MikroOrmOutboxRepository } from '../infra/persistence/repositories/outbox.repository';
import { MikroOrmLedgerRepository } from '../infra/persistence/repositories/ledger.repository';
import { MikroOrmUnitOfWork } from '../infra/persistence/repositories/unit-of-work';
import { ProcessWagerTransactionUseCase } from '../application/use-cases/process-wager-transaction/process-wager-transaction.use-case';
import { SqsConsumerService } from './sqs-consumer.service';

const REPOSITORY_PROVIDERS = [
  { provide: WALLET_REPOSITORY, useClass: MikroOrmWalletRepository },
  { provide: WAGER_TRANSACTION_REPOSITORY, useClass: MikroOrmWagerTransactionRepository },
  { provide: INBOX_REPOSITORY, useClass: MikroOrmInboxRepository },
  { provide: OUTBOX_REPOSITORY, useClass: MikroOrmOutboxRepository },
  { provide: LEDGER_REPOSITORY, useClass: MikroOrmLedgerRepository },
  { provide: UNIT_OF_WORK, useClass: MikroOrmUnitOfWork },
];

@Module({
  imports: [MikroOrmModule.forRoot(config)],
  providers: [
    ...REPOSITORY_PROVIDERS,
    ProcessWagerTransactionUseCase,
    SqsConsumerService,
  ],
  exports: [SqsConsumerService],
})
export class ConsumersModule {}