import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { Money } from '../../../domain/money/money';
import { Wallet } from '../../../domain/wallet/wallet';
import { WagerTransaction } from '../../../domain/wagering/wager-transaction';
import { OutboxMessage } from '../../../domain/messaging/outbox-message';
import { WagerTransactionProcessed } from '../../../domain/wagering/events/wager-transaction-processed';
import { WalletBalanceChanged } from '../../../domain/wagering/events/wallet-balance-changed';
import { WALLET_REPOSITORY } from '../../ports/wallet.repository';
import type { WalletRepository } from '../../ports/wallet.repository';
import { WAGER_TRANSACTION_REPOSITORY } from '../../ports/wager-transaction.repository';
import type { WagerTransactionRepository } from '../../ports/wager-transaction.repository';
import { LEDGER_REPOSITORY } from '../../ports/ledger.repository';
import type { LedgerRepository } from '../../ports/ledger.repository';
import { OUTBOX_REPOSITORY } from '../../ports/outbox.repository';
import type { OutboxRepository } from '../../ports/outbox.repository';
import { UNIT_OF_WORK } from '../../ports/unit-of-work';
import type { UnitOfWork } from '../../ports/unit-of-work';
import { CreateWalletCommand } from './create-wallet.command';
import { CreateWalletResult } from './create-wallet.result';
import { WalletAlreadyExistsError } from './create-wallet.errors';

@Injectable()
export class CreateWalletUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY)
    private readonly transactions: WagerTransactionRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
  ) {}

  async execute(command: CreateWalletCommand): Promise<CreateWalletResult> {
    return this.uow.run(async () => {
      const initialBalance = Money.from(command.initialBalance);
      const wallet = Wallet.open({
        id: randomUUID(),
        playerId: command.playerId,
        initialBalance: Money.zero(command.initialBalance.currency),
      });

      if (!initialBalance.isPositive()) {
        try {
          await this.wallets.save(wallet);
        } catch (err) {
          if (err instanceof UniqueConstraintViolationException) {
            throw new WalletAlreadyExistsError(command.playerId, wallet.currency);
          }
          throw err;
        }
        return {
          id: wallet.id,
          playerId: wallet.playerId,
          balance: wallet.balance.toJSON(),
          version: wallet.version,
        };
      }

      const openingTx = WagerTransaction.createOpening({
        id: randomUUID(),
        providerId: 'internal',
        externalTransactionId: `opening-${wallet.id}`,
        idempotencyKey: `internal:opening:${wallet.id}`,
        payloadHash: 'opening',
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: 'opening',
        gameId: 'opening',
        money: initialBalance,
      });

      const { wallet: after, entry } = wallet.credit(
        openingTx.id,
        initialBalance,
        randomUUID(),
      );
      openingTx.markProcessed(undefined, new Date());

      try {
        await this.wallets.save(after);
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) {
          throw new WalletAlreadyExistsError(command.playerId, wallet.currency);
        }
        throw err;
      }
      await this.transactions.save(openingTx);
      await this.ledger.save(entry);

      const baseCtx = {
        correlationId: command.correlationId,
        causationId: wallet.id,
        occurredAt: new Date(),
      };
      await this.outbox.save(
        OutboxMessage.enqueue(
          WagerTransactionProcessed.from(openingTx, {
            ...baseCtx,
            eventId: randomUUID(),
          }),
        ),
      );
      await this.outbox.save(
        OutboxMessage.enqueue(
          WalletBalanceChanged.from(after, entry, {
            ...baseCtx,
            eventId: randomUUID(),
          }),
        ),
      );

      return {
        id: after.id,
        playerId: after.playerId,
        balance: after.balance.toJSON(),
        version: after.version,
      };
    });
  }
}