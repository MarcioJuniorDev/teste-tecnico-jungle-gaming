import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { Money } from '../../../domain/money/money';
import { Wallet } from '../../../domain/wallet/wallet';
import { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry';
import { LedgerDirection } from '../../../domain/ledger/ledger-direction';
import { WagerTransaction } from '../../../domain/wagering/wager-transaction';
import { WagerTransactionKind } from '../../../domain/wagering/wager-transaction-kind';
import { WagerTransactionStatus } from '../../../domain/wagering/wager-transaction-status';
import { FailureCode } from '../../../domain/wagering/failure-code';
import { WagerPolicy } from '../../../domain/wagering/wager-policy';
import { InboxMessage } from '../../../domain/messaging/inbox-message';
import { OutboxMessage } from '../../../domain/messaging/outbox-message';
import { EventContext } from '../../../domain/wagering/event-context';
import { WagerTransactionProcessed } from '../../../domain/wagering/events/wager-transaction-processed';
import { WagerTransactionRejected } from '../../../domain/wagering/events/wager-transaction-rejected';
import { WagerTransactionPendingReference } from '../../../domain/wagering/events/wager-transaction-pending-reference';
import { WalletBalanceChanged } from '../../../domain/wagering/events/wallet-balance-changed';
import { UNIT_OF_WORK } from '../../ports/unit-of-work';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../ports/unit-of-work';
import { ProcessWagerTransactionCommand } from './process-wager-transaction.command';
import { ProcessWagerTransactionResult } from './process-wager-transaction.result';
import { IdempotencyConflictError } from './process-wager-transaction.errors';
import { computePayloadHash } from './payload-hash';

@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async execute(
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    return this.uow.run((repos) => this.runWithinTransaction(repos, command));
  }

  private async runWithinTransaction(
    repos: TransactionalRepositories,
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    const payloadHash = computePayloadHash(command);
    let inboxMessage: InboxMessage | null = null;

    if (command.inbox) {
      const inboxResult = await this.handleInbox(repos, command, payloadHash);
      if (inboxResult.replay !== null) return inboxResult.replay;
      inboxMessage = inboxResult.created;
    }

    const existing = await repos.transactions.findByIdempotencyKey(
      command.providerId,
      command.idempotencyKey,
    );
    if (existing) {
      const result = existing.matchesPayload(payloadHash)
        ? this.resultFromTransaction(existing, true)
        : this.throwConflict(command.idempotencyKey);
      await this.markInboxProcessed(repos, inboxMessage);
      return result;
    }

    const tx = WagerTransaction.create({
      id: randomUUID(),
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      idempotencyKey: command.idempotencyKey,
      payloadHash,
      walletId: command.walletId,
      playerId: command.playerId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: Money.from(command.money),
      referenceExternalTransactionId: command.referenceExternalTransactionId,
    });

    const raceResult = await this.persistTransactionWithRaceHandling(
      repos,
      tx,
      payloadHash,
      command.idempotencyKey,
    );
    if (raceResult) {
      await this.markInboxProcessed(repos, inboxMessage);
      return raceResult;
    }

    const result = await this.processNewTransaction(repos, tx, command);
    await this.markInboxProcessed(repos, inboxMessage);
    return result;
  }

  private async persistTransactionWithRaceHandling(
    repos: TransactionalRepositories,
    tx: WagerTransaction,
    payloadHash: string,
    idempotencyKey: string,
  ): Promise<ProcessWagerTransactionResult | null> {
    try {
      await repos.transactions.save(tx);
      return null;
    } catch (err) {
      if (!(err instanceof UniqueConstraintViolationException)) throw err;
      const winner = await repos.transactions.findByIdempotencyKey(
        tx.providerId,
        idempotencyKey,
      );
      if (!winner) throw err;
      if (winner.matchesPayload(payloadHash)) {
        return this.resultFromTransaction(winner, true);
      }
      throw new IdempotencyConflictError(idempotencyKey);
    }
  }

  private async processNewTransaction(
    repos: TransactionalRepositories,
    tx: WagerTransaction,
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    const wallet = await repos.wallets.findByIdForUpdate(command.walletId);
    if (!wallet) {
      return this.reject(repos, tx, FailureCode.WalletNotFound, command);
    }

    const reference = tx.requiresReference()
      ? await repos.transactions.findByProviderAndExternalId(
          command.providerId,
          tx.referenceExternalTransactionId!,
        )
      : null;

    const existingReversals = reference
      ? {
          refund:
            (await repos.transactions.findProcessedReversalFor(
              reference.id,
              WagerTransactionKind.Refund,
            )) !== null,
          rollback:
            (await repos.transactions.findProcessedReversalFor(
              reference.id,
              WagerTransactionKind.Rollback,
            )) !== null,
        }
      : { refund: false, rollback: false };

    const decision = WagerPolicy.evaluate({
      transaction: tx,
      walletBalance: wallet.balance,
      reference,
      existingReversals,
    });

    if (decision.action === 'PENDING_REFERENCE') {
      tx.markPendingReference();
      await repos.transactions.save(tx);
      await this.enqueue(
        repos,
        OutboxMessage.enqueue(
          WagerTransactionPendingReference.from(
            tx,
            this.context(tx.id, command),
          ),
        ),
      );
      return this.resultFromTransaction(tx, false);
    }

    if (decision.action === 'REJECT') {
      return this.reject(repos, tx, decision.failureCode, command);
    }

    return this.applyAndPersist(repos, tx, wallet, reference, command);
  }

  private async handleInbox(
    repos: TransactionalRepositories,
    command: ProcessWagerTransactionCommand,
    payloadHash: string,
  ): Promise<{
    replay: ProcessWagerTransactionResult | null;
    created: InboxMessage | null;
  }> {
    const { consumerName, messageId } = command.inbox!;
    const existing = await repos.inbox.findByConsumerAndMessage(
      consumerName,
      messageId,
    );

    if (existing && existing.isProcessed()) {
      const tx = await repos.transactions.findByIdempotencyKey(
        command.providerId,
        command.idempotencyKey,
      );
      if (tx) {
        return { replay: this.resultFromTransaction(tx, true), created: null };
      }
      return {
        replay: {
          transactionId: '',
          status: WagerTransactionStatus.Rejected,
          idempotentReplay: true,
          failureCode: FailureCode.InternalError,
        },
        created: null,
      };
    }
    if (existing) {
      return { replay: null, created: existing };
    }
    const created = InboxMessage.receive({
      consumerName,
      messageId,
      payloadHash,
    });
    await repos.inbox.save(created);
    return { replay: null, created };
  }

  private async markInboxProcessed(
    repos: TransactionalRepositories,
    inboxMessage: InboxMessage | null,
  ): Promise<void> {
    if (!inboxMessage || inboxMessage.isProcessed()) return;
    inboxMessage.markProcessed(new Date());
    await repos.inbox.save(inboxMessage);
  }

  private throwConflict(idempotencyKey: string): never {
    throw new IdempotencyConflictError(idempotencyKey);
  }

  private async applyAndPersist(
    repos: TransactionalRepositories,
    tx: WagerTransaction,
    wallet: Wallet,
    reference: WagerTransaction | null,
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    if (!tx.affectsBalance()) {
      tx.markProcessed(undefined, new Date());
      await repos.transactions.save(tx);
      await this.enqueue(
        repos,
        OutboxMessage.enqueue(
          WagerTransactionProcessed.from(tx, this.context(tx.id, command)),
        ),
      );
      return this.resultFromTransaction(tx, false);
    }

    const direction = tx.ledgerDirectionFor(reference ?? undefined);
    const entryId = randomUUID();
    const movement =
      direction === LedgerDirection.Credit
        ? wallet.credit(tx.id, tx.money, entryId)
        : wallet.debit(tx.id, tx.money, entryId);

    await this.persistLedger(repos, movement.entry);
    await repos.wallets.save(movement.wallet);
    tx.markProcessed(reference?.id, new Date());
    await repos.transactions.save(tx);

    const baseCtx = {
      correlationId: command.correlationId,
      causationId: tx.id,
      occurredAt: new Date(),
    };
    await this.enqueue(
      repos,
      OutboxMessage.enqueue(
        WagerTransactionProcessed.from(tx, {
          ...baseCtx,
          eventId: randomUUID(),
        }),
      ),
    );
    await this.enqueue(
      repos,
      OutboxMessage.enqueue(
        WalletBalanceChanged.from(movement.wallet, movement.entry, {
          ...baseCtx,
          eventId: randomUUID(),
        }),
      ),
    );

    return {
      transactionId: tx.id,
      status: WagerTransactionStatus.Processed,
      idempotentReplay: false,
      balance: movement.wallet.balance.toJSON(),
    };
  }

  private async reject(
    repos: TransactionalRepositories,
    tx: WagerTransaction,
    code: FailureCode,
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    tx.reject(code);
    await repos.transactions.save(tx);
    await this.enqueue(
      repos,
      OutboxMessage.enqueue(
        WagerTransactionRejected.from(tx, code, this.context(tx.id, command)),
      ),
    );
    return this.resultFromTransaction(tx, false);
  }

  private async persistLedger(
    repos: TransactionalRepositories,
    entry: WalletLedgerEntry,
  ): Promise<void> {
    await repos.ledger.save(entry);
  }

  private async enqueue(
    repos: TransactionalRepositories,
    message: OutboxMessage,
  ): Promise<void> {
    await repos.outbox.save(message);
  }

  private context(
    aggregateId: string,
    command: ProcessWagerTransactionCommand,
  ): EventContext {
    return {
      eventId: randomUUID(),
      correlationId: command.correlationId,
      causationId: aggregateId,
      occurredAt: new Date(),
    };
  }

  private resultFromTransaction(
    tx: WagerTransaction,
    replay: boolean,
  ): ProcessWagerTransactionResult {
    const status =
      tx.status === WagerTransactionStatus.Processed
        ? WagerTransactionStatus.Processed
        : tx.status === WagerTransactionStatus.Rejected
          ? WagerTransactionStatus.Rejected
          : WagerTransactionStatus.PendingReference;
    const result: ProcessWagerTransactionResult = {
      transactionId: tx.id,
      status,
      idempotentReplay: replay,
    };
    if (tx.status === WagerTransactionStatus.Rejected && tx.failureCode) {
      result.failureCode = tx.failureCode;
    }
    return result;
  }
}