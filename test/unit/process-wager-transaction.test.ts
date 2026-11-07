import { describe, expect, test } from 'bun:test';
import { ProcessWagerTransactionUseCase } from '../../src/application/use-cases/process-wager-transaction/process-wager-transaction.use-case';
import { IdempotencyConflictError } from '../../src/application/use-cases/process-wager-transaction/process-wager-transaction.errors';
import { Money } from '../../src/domain/money/money';
import { Wallet } from '../../src/domain/wallet/wallet';
import { WagerTransaction } from '../../src/domain/wagering/wager-transaction';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction-kind';
import { WagerTransactionStatus } from '../../src/domain/wagering/wager-transaction-status';
import { FailureCode } from '../../src/domain/wagering/failure-code';
import { InboxMessage } from '../../src/domain/messaging/inbox-message';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

function makeFakes() {
  const wallets = new Map<string, Wallet>();
  const txs = new Map<string, WagerTransaction>();
  const inboxes = new Map<string, InboxMessage>();
  const outbox: any[] = [];

  const walletRepo = {
    async findById(id: string) {
      return wallets.get(id) ?? null;
    },
    async findByIdForUpdate(id: string) {
      return wallets.get(id) ?? null;
    },
    async save(w: Wallet) {
      wallets.set(w.id, w);
    },
  };
  const txRepo = {
    async findById(id: string) {
      return txs.get(id) ?? null;
    },
    async findByProviderAndExternalId(providerId: string, externalId: string) {
      return (
        [...txs.values()].find(
          (t) =>
            t.providerId === providerId &&
            t.externalTransactionId === externalId,
        ) ?? null
      );
    },
    async findByIdempotencyKey(providerId: string, key: string) {
      return (
        [...txs.values()].find(
          (t) => t.providerId === providerId && t.idempotencyKey === key,
        ) ?? null
      );
    },
    async findProcessedReversalFor(
      referenceId: string,
      kind: WagerTransactionKind,
    ) {
      return (
        [...txs.values()].find(
          (t) =>
            t.referenceTransactionId === referenceId &&
            t.kind === kind &&
            t.status === WagerTransactionStatus.Processed,
        ) ?? null
      );
    },
    async save(tx: WagerTransaction) {
      txs.set(
        tx.id,
        WagerTransaction.rehydrate({
          id: tx.id,
          providerId: tx.providerId,
          externalTransactionId: tx.externalTransactionId,
          idempotencyKey: tx.idempotencyKey,
          payloadHash: tx.payloadHash,
          walletId: tx.walletId,
          playerId: tx.playerId,
          roundId: tx.roundId,
          gameId: tx.gameId,
          kind: tx.kind,
          money: tx.money,
          referenceExternalTransactionId: tx.referenceExternalTransactionId,
          createdAt: tx.createdAt,
          status: tx.status,
          referenceTransactionId: tx.referenceTransactionId,
          failureCode: tx.failureCode,
          processedAt: tx.processedAt,
        }),
      );
    },
  };
  const inboxRepo = {
    async findByConsumerAndMessage(
      consumerName: string,
      messageId: string,
    ) {
      return inboxes.get(`${consumerName}|${messageId}`) ?? null;
    },
    async save(msg: InboxMessage) {
      inboxes.set(`${msg.consumerName}|${msg.messageId}`, msg);
    },
  };
  const outboxRepo = {
    async findPendingDue() {
      return [];
    },
    async save(msg: any) {
      outbox.push(msg);
    },
  };
  const ledgerRepo = {
    async save() {
      /* no-op */
    },
    async findPage() {
      return { items: [], nextCursor: null };
    },
    async sumByWallet() {
      return { total: brl('0.00'), count: 0 };
    },
  };

  const repos = {
    wallets: walletRepo,
    transactions: txRepo,
    inbox: inboxRepo,
    outbox: outboxRepo,
    ledger: ledgerRepo,
  };

  const uow = {
    async run<T>(fn: (r: typeof repos, em: any) => Promise<T>): Promise<T> {
      return fn(repos, {} as any);
    },
  };

  return {
    wallets,
    txs,
    inboxes,
    outbox,
    walletRepo,
    txRepo,
    inboxRepo,
    outboxRepo,
    ledgerRepo,
    repos,
    uow,
  };
}

const baseCommand = {
  providerId: 'provider-a',
  externalTransactionId: 'ext-1',
  idempotencyKey: 'provider-a:ext-1',
  playerId: 'p1',
  walletId: 'w1',
  roundId: 'r1',
  gameId: 'g1',
  kind: WagerTransactionKind.Bet,
  money: { amount: '25.00', currency: 'BRL' },
  correlationId: 'corr-1',
};

function makeUseCase(f: ReturnType<typeof makeFakes>) {
  return new ProcessWagerTransactionUseCase(f.uow as any);
}

describe('ProcessWagerTransactionUseCase', () => {
  test('BET with sufficient balance is PROCESSED and updates wallet', async () => {
    const f = makeFakes();
    f.wallets.set(
      'w1',
      Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('100.00') }),
    );
    const uc = makeUseCase(f);

    const result = await uc.execute({ ...baseCommand });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.idempotentReplay).toBe(false);
    expect(result.balance).toEqual({ amount: '75.00', currency: 'BRL' });
    expect(f.outbox.length).toBeGreaterThanOrEqual(1);
  });

  test('BET with insufficient balance is REJECTED', async () => {
    const f = makeFakes();
    f.wallets.set(
      'w1',
      Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('10.00') }),
    );
    const uc = makeUseCase(f);

    const result = await uc.execute({ ...baseCommand });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.InsufficientFunds);
  });

  test('idempotent replay returns the original result', async () => {
    const f = makeFakes();
    f.wallets.set(
      'w1',
      Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('100.00') }),
    );
    const uc = makeUseCase(f);

    const first = await uc.execute({ ...baseCommand });
    const second = await uc.execute({ ...baseCommand });

    expect(second.idempotentReplay).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
  });

  test('same idempotency key with different payload throws conflict', async () => {
    const f = makeFakes();
    f.wallets.set(
      'w1',
      Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('100.00') }),
    );
    const uc = makeUseCase(f);

    await uc.execute({ ...baseCommand });
    await expect(
      uc.execute({ ...baseCommand, money: { amount: '30.00', currency: 'BRL' } }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test('LOSS is PROCESSED without moving balance', async () => {
    const f = makeFakes();
    f.wallets.set(
      'w1',
      Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('100.00') }),
    );
    const uc = makeUseCase(f);

    const result = await uc.execute({
      ...baseCommand,
      kind: WagerTransactionKind.Loss,
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toBeUndefined();
    expect(f.wallets.get('w1')!.balance.toJSON()).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });
  });

  test('REFUND without reference is PENDING_REFERENCE', async () => {
    const f = makeFakes();
    f.wallets.set(
      'w1',
      Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('100.00') }),
    );
    const uc = makeUseCase(f);

    const result = await uc.execute({
      ...baseCommand,
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-0',
    });

    expect(result.status).toBe(WagerTransactionStatus.PendingReference);
  });

  test('missing wallet is REJECTED with WALLET_NOT_FOUND', async () => {
    const f = makeFakes();
    const uc = makeUseCase(f);

    const result = await uc.execute({ ...baseCommand });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.WalletNotFound);
  });

  test('inbox replay returns the original result and does not process twice', async () => {
    const f = makeFakes();
    f.wallets.set(
      'w1',
      Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('100.00') }),
    );
    const uc = makeUseCase(f);
    const command = {
      ...baseCommand,
      inbox: { consumerName: 'wager-consumer', messageId: 'msg-1' },
    };

    const first = await uc.execute(command);
    const second = await uc.execute(command);

    expect(first.status).toBe(WagerTransactionStatus.Processed);
    expect(second.idempotentReplay).toBe(true);
    expect(f.wallets.get('w1')!.balance.toJSON()).toEqual({
      amount: '75.00',
      currency: 'BRL',
    });
  });
});