import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Harness, bootstrapHarness } from '../helpers/concurrency-harness';
import { assertLedgerConsistent } from '../helpers/assert-ledger-consistent';
import { Money } from '../../src/domain/money/money';
import { WalletEntity } from '../../src/infra/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from '../../src/infra/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../src/infra/persistence/entities/wallet-ledger-entry.entity';
import { WagerTransactionStatus } from '../../src/domain/wagering/wager-transaction-status';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction-kind';
import { FailureCode } from '../../src/domain/wagering/failure-code';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

async function createWalletWithBalance(
  h: Harness,
  playerId: string,
  initial: string,
): Promise<string> {
  const result = await h.createWallet.execute({
    playerId,
    initialBalance: brl(initial).toJSON(),
    correlationId: randomUUID(),
  });
  return result.id;
}

async function submitBet(
  h: Harness,
  walletId: string,
  playerId: string,
  externalId: string,
  amount: string,
) {
  return h.processTransaction.execute({
    providerId: 'provider-a',
    externalTransactionId: externalId,
    idempotencyKey: `provider-a:${externalId}`,
    playerId,
    walletId,
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: brl(amount).toJSON(),
    correlationId: randomUUID(),
  });
}

describe('Concorrência: wallet', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await bootstrapHarness();
    const em = h.orm.em.fork();
    await em.execute('truncate table wallet_ledger_entries, wager_transactions, wallets, inbox_messages, outbox_messages cascade');
  });

  afterAll(async () => {
    await h.close();
  });

  test('saldo 100, duas apostas de 80 simultâneas → 1 PROCESSED, 1 REJECTED, saldo 20, 1 débito', async () => {
    const playerId = randomUUID();
    const walletId = await createWalletWithBalance(h, playerId, '100.00');

    const [r1, r2] = await Promise.all([
      submitBet(h, walletId, playerId, 'ext-conc-1', '80.00'),
      submitBet(h, walletId, playerId, 'ext-conc-2', '80.00'),
    ]);

    const processed = [r1, r2].filter((r) => r.status === WagerTransactionStatus.Processed);
    const rejected = [r1, r2].filter((r) => r.status === WagerTransactionStatus.Rejected);
    expect(processed.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].failureCode).toBe(FailureCode.InsufficientFunds);

    const em = h.orm.em.fork();
    const wallet = await em.findOne(WalletEntity, { id: walletId });
    expect(Number(wallet!.balance.amount)).toBe(20);

    const debits = await em.find(WalletLedgerEntryEntity, {
      walletId,
      direction: 'DEBIT',
    });
    expect(debits.length).toBe(1);

    await assertLedgerConsistent(em, walletId);
  });

  test('mesma aposta × 50 em paralelo → 1 débito, 49 replays', async () => {
    const playerId = randomUUID();
    const walletId = await createWalletWithBalance(h, playerId, '1000.00');

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        submitBet(h, walletId, playerId, 'ext-conc-dup', '10.00'),
      ),
    );

    const processed = results.filter((r) => !r.idempotentReplay && r.status === WagerTransactionStatus.Processed);
    const replays = results.filter((r) => r.idempotentReplay);
    expect(processed.length).toBe(1);
    expect(replays.length).toBe(49);

    const em = h.orm.em.fork();
    const wallet = await em.findOne(WalletEntity, { id: walletId });
    expect(Number(wallet!.balance.amount)).toBe(990);

    const debits = await em.find(WalletLedgerEntryEntity, {
      walletId,
      direction: 'DEBIT',
    });
    expect(debits.length).toBe(1);

    await assertLedgerConsistent(em, walletId);
  });
});