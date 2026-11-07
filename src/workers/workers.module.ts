import { Module } from '@nestjs/common';
import { PersistenceModule } from '../infra/persistence/persistence.module';
import { ProcessWagerTransactionUseCase } from '../application/use-cases/process-wager-transaction/process-wager-transaction.use-case';
import { OutboxPublisherService } from './outbox-publisher.service';
import { PendingReferenceWorker } from './pending-reference.worker';

@Module({
  imports: [PersistenceModule],
  providers: [
    ProcessWagerTransactionUseCase,
    OutboxPublisherService,
    PendingReferenceWorker,
  ],
  exports: [OutboxPublisherService, PendingReferenceWorker],
})
export class WorkersModule {}