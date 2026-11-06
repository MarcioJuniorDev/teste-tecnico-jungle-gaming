import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../infra/persistence/persistence.module';
import { WalletController } from './controllers/wallet.controller';
import { WagerTransactionController } from './controllers/wager-transaction.controller';
import { CreateWalletUseCase } from '../../application/use-cases/create-wallet/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../application/use-cases/process-wager-transaction/process-wager-transaction.use-case';

@Module({
  imports: [PersistenceModule],
  controllers: [WalletController, WagerTransactionController],
  providers: [CreateWalletUseCase, ProcessWagerTransactionUseCase],
})
export class HttpModule {}