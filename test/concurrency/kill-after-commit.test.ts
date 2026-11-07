import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import { setupIntegrationDb, teardownIntegrationDb } from '../integration/setup';
import { assertLedgerConsistent } from '../helpers/assert-ledger-consistent';
import { Money } from '../../src/domain/money/money';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction-kind';
import { WalletEntity } from '../../src/infra/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from '../../src/infra/persistence/entities/wager-transaction.entity';
import { bootstrapHarness, Harness } from '../helpers/concurrency-harness';
import { WagerTransactionStatus } from '../../src/domain/wagering/wager-transaction-status';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe('Concorrência: worker morto após commit, antes do ack', () => {
  let h: Harness;
  let orm: MikroORM;

  beforeAll(async () => {
    process.env.DB_NAME = 'wagering_test';
    orm = await setupIntegrationDb();
    const em = orm.em.fork();
    await em.execute('truncate table wallet_ledger_entries, wager_transactions, wallets, inbox_messages, outbox_messages cascade');
    h = await bootstrapHarness();
  });

  afterAll(async () => {
    if (h) await h.close();
    // Não fecha o orm global (o setupIntegrationDb reutiliza)
  });

  test('mensagem processada + commit, worker morto antes do ack → redelivery não duplica', async () => {
    const em = h.orm.em.fork();  // usa o orm do harness (mesmo banco do createWallet)
    const playerId = randomUUID();
    const wallet = await h.createWallet.execute({
      playerId,
      initialBalance: brl('100.00').toJSON(),
      correlationId: randomUUID(),
    });
    const walletId = wallet.id;

    const result = await h.processTransaction.execute({
      providerId: 'provider-a',
      externalTransactionId: 'ext-kill-1',
      idempotencyKey: 'provider-a:ext-kill-1',
      playerId,
      walletId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: brl('10.00').toJSON(),
      correlationId: randomUUID(),
    });
    expect(result.status).toBe(WagerTransactionStatus.Processed);

    const replay = await h.processTransaction.execute({
      providerId: 'provider-a',
      externalTransactionId: 'ext-kill-1',
      idempotencyKey: 'provider-a:ext-kill-1',
      playerId,
      walletId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: brl('10.00').toJSON(),
      correlationId: randomUUID(),
    });
    expect(replay.idempotentReplay).toBe(true);

    const w = await em.findOne(WalletEntity, { id: walletId });
    expect(Number(w!.balance.amount)).toBe(90);

    const tx = await em.findOne(WagerTransactionEntity, {
      externalTransactionId: 'ext-kill-1',
    });
    expect(tx!.status).toBe('PROCESSED');

    await assertLedgerConsistent(em, walletId);
  });
});