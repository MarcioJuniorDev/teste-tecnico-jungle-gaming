import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
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

import { WALLET_REPOSITORY } from '../../ports/wallet.repository';
import type { WalletRepository } from '../../ports/wallet.repository';

import { WAGER_TRANSACTION_REPOSITORY } from '../../ports/wager-transaction.repository';
import type { WagerTransactionRepository } from '../../ports/wager-transaction.repository';

import { INBOX_REPOSITORY } from '../../ports/inbox.repository';
import type { InboxRepository } from '../../ports/inbox.repository';

import { OUTBOX_REPOSITORY } from '../../ports/outbox.repository';
import type { OutboxRepository } from '../../ports/outbox.repository';

import { LEDGER_REPOSITORY } from '../../ports/ledger.repository';
import type { LedgerRepository } from '../../ports/ledger.repository';

import { UNIT_OF_WORK } from '../../ports/unit-of-work';
import type { UnitOfWork } from '../../ports/unit-of-work';

import { ProcessWagerTransactionCommand } from './process-wager-transaction.command';
import { ProcessWagerTransactionResult } from './process-wager-transaction.result';
import { IdempotencyConflictError } from './process-wager-transaction.errors';
import { computePayloadHash } from './payload-hash';

@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY)
    private readonly transactions: WagerTransactionRepository,
    @Inject(INBOX_REPOSITORY) private readonly inbox: InboxRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository,
  ) { }

  async execute(
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    return this.uow.run((em) => this.runWithinTransaction(em, command));
  }

  private async runWithinTransaction(
    _em: EntityManager,
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    const payloadHash = computePayloadHash(command);
    let inboxMessage: InboxMessage | null = null;

    if (command.inbox) {
      const inboxResult = await this.handleInbox(command, payloadHash);
      if (inboxResult.replay !== null) return inboxResult.replay;
      inboxMessage = inboxResult.created;
    }

    const existing = await this.transactions.findByIdempotencyKey(
      command.providerId,
      command.idempotencyKey,
    );
    if (existing) {
      const result = existing.matchesPayload(payloadHash)
        ? this.resultFromTransaction(existing, true)
        : this.throwConflict(command.idempotencyKey);
      await this.markInboxProcessed(inboxMessage);
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
      tx,
      payloadHash,
      command.idempotencyKey,
    );
    if (raceResult) {
      await this.markInboxProcessed(inboxMessage);
      return raceResult;
    }

    const result = await this.processNewTransaction(tx, command);
    await this.markInboxProcessed(inboxMessage);
    return result;
  }

  private async persistTransactionWithRaceHandling(
    tx: WagerTransaction,
    payloadHash: string,
    idempotencyKey: string,
  ): Promise<ProcessWagerTransactionResult | null> {
    try {
      await this.transactions.save(tx);
      return null;
    } catch (err) {
      if (!(err instanceof UniqueConstraintViolationException)) throw err;
      const winner = await this.transactions.findByIdempotencyKey(
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
    tx: WagerTransaction,
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    const wallet = await this.wallets.findByIdForUpdate(command.walletId);
    if (!wallet) {
      return this.reject(tx, FailureCode.WalletNotFound, command);
    }

    const reference = tx.requiresReference()
      ? await this.transactions.findByProviderAndExternalId(
        command.providerId,
        tx.referenceExternalTransactionId!,
      )
      : null;

    const existingReversals = reference
      ? {
        refund:
          (await this.transactions.findProcessedReversalFor(
            reference.id,
            WagerTransactionKind.Refund,
          )) !== null,
        rollback:
          (await this.transactions.findProcessedReversalFor(
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
      await this.transactions.save(tx);
      await this.enqueue(
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
      return this.reject(tx, decision.failureCode, command);
    }

    return this.applyAndPersist(tx, wallet, reference, command);
  }

  private async handleInbox(
    command: ProcessWagerTransactionCommand,
    payloadHash: string,
  ): Promise<{ replay: ProcessWagerTransactionResult | null; created: InboxMessage | null }> {
    const { consumerName, messageId } = command.inbox!;
    const existing = await this.inbox.findByConsumerAndMessage(
      consumerName,
      messageId,
    );
    if (existing && existing.isProcessed()) {
      const tx = await this.transactions.findByIdempotencyKey(
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
      // mensagem já inserida mas não processada (tentativa anterior falhou antes do commit)
      return { replay: null, created: existing };
    }
    const created = InboxMessage.receive({
      consumerName,
      messageId,
      payloadHash,
    });
    await this.inbox.save(created);
    return { replay: null, created };
  }

  private async markInboxProcessed(
    inboxMessage: InboxMessage | null,
  ): Promise<void> {
    if (!inboxMessage || inboxMessage.isProcessed()) return;
    inboxMessage.markProcessed(new Date());
    await this.inbox.save(inboxMessage);
  }

  private throwConflict(idempotencyKey: string): never {
    throw new IdempotencyConflictError(idempotencyKey);
  }

  private async applyAndPersist(
    tx: WagerTransaction,
    wallet: Wallet,
    reference: WagerTransaction | null,
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    if (!tx.affectsBalance()) {
      tx.markProcessed(undefined, new Date());
      await this.transactions.save(tx);
      await this.enqueue(
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

    await this.persistLedger(movement.entry);
    await this.wallets.save(movement.wallet);
    tx.markProcessed(reference?.id, new Date());
    await this.transactions.save(tx);

    const baseCtx = {
      correlationId: command.correlationId,
      causationId: tx.id,
      occurredAt: new Date(),
    };
    await this.enqueue(
      OutboxMessage.enqueue(
        WagerTransactionProcessed.from(tx, { ...baseCtx, eventId: randomUUID() }),
      ),
    );
    await this.enqueue(
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
    tx: WagerTransaction,
    code: FailureCode,
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    tx.reject(code);
    await this.transactions.save(tx);
    await this.enqueue(
      OutboxMessage.enqueue(
        WagerTransactionRejected.from(tx, code, this.context(tx.id, command)),
      ),
    );
    return this.resultFromTransaction(tx, false);
  }

  private async persistLedger(entry: WalletLedgerEntry): Promise<void> {
    await this.ledger.save(entry);
  }

  private async enqueue(message: OutboxMessage): Promise<void> {
    await this.outbox.save(message);
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