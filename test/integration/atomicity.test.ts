import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { setupIntegrationDb, teardownIntegrationDb } from './setup';
import { createWallet } from '../helpers/integration-harness';
import { assertLedgerConsistent } from '../helpers/assert-ledger-consistent';
import { WalletEntity } from '../../src/infra/persistence/entities/wallet.entity';
import { InboxMessageEntity } from '../../src/infra/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../src/infra/persistence/entities/outbox-message.entity';

describe('Atomicidade', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await setupIntegrationDb();
  });

  afterAll(async () => {
    await teardownIntegrationDb();
  });

  test('falha no meio da transação não persiste wallet nem outbox', async () => {
    const em = orm.em.fork();
    const playerId = crypto.randomUUID();
    try {
      await em.transactional(async (tx) => {
        await tx.execute(
          `insert into wallets (id, player_id, currency, balance_amount, balance_currency, version, created_at, updated_at)
           values (?, ?, 'BRL', 100.00, 'BRL', 1, now(), now())`,
          [crypto.randomUUID(), playerId],
        );
        await tx.execute(
          `insert into outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts)
           values (?, ?, 'FakeEvent', '{}', now(), 0)`,
          [crypto.randomUUID(), playerId],
        );
        throw new Error('forced failure');
      });
    } catch {
      // esperado
    }
    const wallets = await em.find(WalletEntity, { playerId });
    const outboxes = await em.find(OutboxMessageEntity, { aggregateId: playerId });
    expect(wallets.length).toBe(0);
    expect(outboxes.length).toBe(0);
  });

  test('ledger consistente após operações', async () => {
    const em = orm.em.fork();
    const walletId = crypto.randomUUID();
    await em.execute(
      `insert into wallets (id, player_id, currency, balance_amount, balance_currency, version, created_at, updated_at)
       values (?, ?, 'BRL', 100.00, 'BRL', 1, now(), now())`,
      [walletId, crypto.randomUUID()],
    );
    await em.execute(
      `insert into wallet_ledger_entries (id, wallet_id, transaction_id, direction, money_amount, money_currency, balance_before_amount, balance_before_currency, balance_after_amount, balance_after_currency, created_at)
       values (?, ?, ?, 'CREDIT', 100.00, 'BRL', 0.00, 'BRL', 100.00, 'BRL', now())`,
      [crypto.randomUUID(), walletId, crypto.randomUUID()],
    );
    await assertLedgerConsistent(em, walletId);
  });
});