import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../infra/persistence/persistence.module';
import { WalletController } from './controllers/wallet.controller';
import { WagerTransactionController } from './controllers/wager-transaction.controller';
import { HealthController } from './controllers/health.controller';
import { LedgerController } from './controllers/ledger.controller';
import { ReconciliationController } from './controllers/reconciliation.controller';
import { DbHealthIndicator } from './health/db.health-indicator';
import { SqsHealthIndicator } from './health/sqs.health-indicator';
import { CreateWalletUseCase } from '../../application/use-cases/create-wallet/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../application/use-cases/process-wager-transaction/process-wager-transaction.use-case';
import { ReconcileWalletUseCase } from '../../application/use-cases/reconcile-wallet/reconcile-wallet.use-case';

@Module({
  imports: [PersistenceModule],
  controllers: [
    WalletController,
    WagerTransactionController,
    HealthController,
    LedgerController,
    ReconciliationController,
  ],
  providers: [
    CreateWalletUseCase,
    ProcessWagerTransactionUseCase,
    ReconcileWalletUseCase,
    DbHealthIndicator,
    SqsHealthIndicator,
  ],
})
export class HttpModule { }