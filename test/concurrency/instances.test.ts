import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import { setupIntegrationDb, teardownIntegrationDb } from '../integration/setup';
import { assertLedgerConsistent } from '../helpers/assert-ledger-consistent';
import { CreateWalletUseCase } from '../../src/application/use-cases/create-wallet/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../src/application/use-cases/process-wager-transaction/process-wager-transaction.use-case';
import { Money } from '../../src/domain/money/money';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction-kind';
import { WagerTransactionStatus } from '../../src/domain/wagering/wager-transaction-status';
import { WalletEntity } from '../../src/infra/persistence/entities/wallet.entity';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

function sh(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', shell: 'powershell.exe' }).trim();
}

describe('Concorrência: 3 instâncias (Compose)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await setupIntegrationDb();
    const em = orm.em.fork();
    await em.execute('truncate table wallet_ledger_entries, wager_transactions, wallets, inbox_messages, outbox_messages cascade');
    // O Compose já está de pé (a app foi subida manualmente).
    // Apenas aguarda os health checks.
    await new Promise((r) => setTimeout(r, 2_000));
  });

  afterAll(async () => {
    await teardownIntegrationDb();
  });

  test('3 instâncias da app respondem health/live', async () => {
    const containers = sh('docker ps --filter "name=teste-tecnico-jungle-gaming-app-" --format "{{.Names}}"')
      .split('\n')
      .filter(Boolean);
    expect(containers.length).toBe(3);
    for (const container of containers) {
      const body = sh(
        `docker exec ${container} bun -e "const r = await fetch('http://localhost:3000/health/live'); console.log(await r.text())"`,
      );
      expect(body).toContain('"status":"ok"');
    }
  });

  test('invariante final: wallet.balance == soma do ledger', async () => {
    const em = orm.em.fork();
    const wallets = await em.find(WalletEntity, {});
    for (const wallet of wallets) {
      await assertLedgerConsistent(em, wallet.id);
    }
  });
});