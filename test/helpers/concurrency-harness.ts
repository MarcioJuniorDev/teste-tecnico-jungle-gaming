import { NestFactory } from '@nestjs/core';
import { INestApplicationContext } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import { AppModule } from '../../src/app.module';
import { ProcessWagerTransactionUseCase } from '../../src/application/use-cases/process-wager-transaction/process-wager-transaction.use-case';
import { CreateWalletUseCase } from '../../src/application/use-cases/create-wallet/create-wallet.use-case';

export interface Harness {
  app: INestApplicationContext;
  orm: MikroORM;
  processTransaction: ProcessWagerTransactionUseCase;
  createWallet: CreateWalletUseCase;
  close: () => Promise<void>;
}

export async function bootstrapHarness(): Promise<Harness> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const orm = app.get(MikroORM) as unknown as MikroORM;
  const processTransaction = app.get(ProcessWagerTransactionUseCase);
  const createWallet = app.get(CreateWalletUseCase);

  return {
    app,
    orm,
    processTransaction,
    createWallet,
    close: async () => {
      await app.close();
    },
  };
}