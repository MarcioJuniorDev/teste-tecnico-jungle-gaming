import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import { setupIntegrationDb, teardownIntegrationDb } from '../integration/setup';
import { assertLedgerConsistent } from '../helpers/assert-ledger-consistent';
import { Money } from '../../src/domain/money/money';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction-kind';
import { WagerTransactionStatus } from '../../src/domain/wagering/wager-transaction-status';
import { WalletEntity } from '../../src/infra/persistence/entities/wallet.entity';
import { bootstrapHarness, Harness } from '../helpers/concurrency-harness';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

function sh(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', shell: 'powershell.exe' }).trim();
}

describe('Concorrência: reinício do serviço', () => {
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
  });

  test('após processar, reiniciar o consumer/worker mantém a consistência', async () => {
    const em = h.orm.em.fork();
    const playerId = randomUUID();
    const wallet = await h.createWallet.execute({
      playerId,
      initialBalance: brl('100.00').toJSON(),
      correlationId: randomUUID(),
    });
    const walletId = wallet.id;

    const result = await h.processTransaction.execute({
      providerId: 'provider-a',
      externalTransactionId: 'ext-restart-1',
      idempotencyKey: 'provider-a:ext-restart-1',
      playerId,
      walletId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: brl('10.00').toJSON(),
      correlationId: randomUUID(),
    });
    expect(result.status).toBe(WagerTransactionStatus.Processed);

    try {
      sh('docker compose restart consumer');
      sh('docker compose restart workers');
    } catch (e) {
      console.warn(`restart warning: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 2_000));

    const w = await em.findOne(WalletEntity, { id: walletId });
    expect(Number(w!.balance.amount)).toBe(90);
    await assertLedgerConsistent(em, walletId);
  }, 20_000);
});