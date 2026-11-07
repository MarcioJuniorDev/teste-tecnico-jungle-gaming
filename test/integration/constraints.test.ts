import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { setupIntegrationDb, teardownIntegrationDb } from './setup';
import { createWallet } from '../helpers/integration-harness';

describe('Constraints do banco', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await setupIntegrationDb();
  });

  afterAll(async () => {
    await teardownIntegrationDb();
  });

  test('CHECK balance_amount >= 0', async () => {
    const em = orm.em.fork();
    const { walletId } = await createWallet(orm);
    await expect(
      em.execute(
        `update wallets set balance_amount = -1 where id = ?`,
        [walletId],
      ),
    ).rejects.toThrow();
  });

  test('CHECK currency = balance_currency', async () => {
    const em = orm.em.fork();
    const { walletId } = await createWallet(orm);
    await expect(
      em.execute(
        `update wallets set currency = 'USD' where id = ?`,
        [walletId],
      ),
    ).rejects.toThrow();
  });

  test('UNIQUE (player_id, currency)', async () => {
    const em = orm.em.fork();
    const { playerId } = await createWallet(orm);
    await expect(
      createWallet(orm, playerId, '50.00'),
    ).rejects.toThrow();
  });

  test('UNIQUE (provider_id, idempotency_key)', async () => {
    const em = orm.em.fork();
    const { walletId } = await createWallet(orm);
    const insert = (id: string) =>
      em.execute(
        `insert into wager_transactions (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency, status, created_at)
         values (?, 'provider-a', ?, 'provider-a:key-1', 'hash', ?, ?, 'r1', 'g1', 'BET', 10.00, 'BRL', 'PENDING', now())`,
        [id, id, walletId, walletId],
      );
    await insert(crypto.randomUUID());
    await expect(insert(crypto.randomUUID())).rejects.toThrow();
  });

  test('CHECK kind válido', async () => {
    const em = orm.em.fork();
    const { walletId } = await createWallet(orm);
    await expect(
      em.execute(
        `insert into wager_transactions (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency, status, created_at)
         values (?, 'provider-a', 'ext-kind', 'provider-a:kind', 'hash', ?, ?, 'r1', 'g1', 'INVALID', 10.00, 'BRL', 'PENDING', now())`,
        [crypto.randomUUID(), walletId, walletId],
      ),
    ).rejects.toThrow();
  });

  test('CHECK money_amount >= 0', async () => {
    const em = orm.em.fork();
    const { walletId } = await createWallet(orm);
    await expect(
      em.execute(
        `insert into wager_transactions (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency, status, created_at)
         values (?, 'provider-a', 'ext-neg', 'provider-a:neg', 'hash', ?, ?, 'r1', 'g1', 'BET', -1.00, 'BRL', 'PENDING', now())`,
        [crypto.randomUUID(), walletId, walletId],
      ),
    ).rejects.toThrow();
  });

  test('UNIQUE parcial de reversão (dupla reversão)', async () => {
    const em = orm.em.fork();
    const { walletId } = await createWallet(orm);
    const refId = crypto.randomUUID();
    const insert = (id: string) =>
      em.execute(
        `insert into wager_transactions (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency, status, created_at, reference_transaction_id)
         values (?, 'provider-a', ?, ?, 'hash', ?, ?, 'r1', 'g1', 'REFUND', 10.00, 'BRL', 'PROCESSED', now(), ?)`,
        [id, id, `provider-a:${id}`, walletId, walletId, refId],
      );
    await insert(crypto.randomUUID());
    await expect(insert(crypto.randomUUID())).rejects.toThrow();
  });

  test('UNIQUE (transaction_id, wallet_id) no ledger', async () => {
    const em = orm.em.fork();
    const { walletId } = await createWallet(orm);
    const txId = crypto.randomUUID();
    const insert = (id: string) =>
      em.execute(
        `insert into wallet_ledger_entries (id, wallet_id, transaction_id, direction, money_amount, money_currency, balance_before_amount, balance_before_currency, balance_after_amount, balance_after_currency, created_at)
         values (?, ?, ?, 'CREDIT', 10.00, 'BRL', 0.00, 'BRL', 10.00, 'BRL', now())`,
        [id, walletId, txId],
      );
    await insert(crypto.randomUUID());
    await expect(insert(crypto.randomUUID())).rejects.toThrow();
  });

  test('CHECK wle_arithmetic (ledger balanceado)', async () => {
    const em = orm.em.fork();
    const { walletId } = await createWallet(orm);
    await expect(
      em.execute(
        `insert into wallet_ledger_entries (id, wallet_id, transaction_id, direction, money_amount, money_currency, balance_before_amount, balance_before_currency, balance_after_amount, balance_after_currency, created_at)
         values (?, ?, ?, 'CREDIT', 10.00, 'BRL', 0.00, 'BRL', 99.00, 'BRL', now())`,
        [crypto.randomUUID(), walletId, crypto.randomUUID()],
      ),
    ).rejects.toThrow();
  });

  test('trigger de imutabilidade: UPDATE no ledger bloqueado', async () => {
    const em = orm.em.fork();
    const { walletId } = await createWallet(orm);
    const entryId = crypto.randomUUID();
    await em.execute(
      `insert into wallet_ledger_entries (id, wallet_id, transaction_id, direction, money_amount, money_currency, balance_before_amount, balance_before_currency, balance_after_amount, balance_after_currency, created_at)
       values (?, ?, ?, 'CREDIT', 10.00, 'BRL', 0.00, 'BRL', 10.00, 'BRL', now())`,
      [entryId, walletId, crypto.randomUUID()],
    );
    await expect(
      em.execute(`update wallet_ledger_entries set money_amount = 99 where id = ?`, [entryId]),
    ).rejects.toThrow();
  });

  test('trigger de imutabilidade: DELETE no ledger bloqueado', async () => {
    const em = orm.em.fork();
    const { walletId } = await createWallet(orm);
    const entryId = crypto.randomUUID();
    await em.execute(
      `insert into wallet_ledger_entries (id, wallet_id, transaction_id, direction, money_amount, money_currency, balance_before_amount, balance_before_currency, balance_after_amount, balance_after_currency, created_at)
       values (?, ?, ?, 'CREDIT', 10.00, 'BRL', 0.00, 'BRL', 10.00, 'BRL', now())`,
      [entryId, walletId, crypto.randomUUID()],
    );
    await expect(
      em.execute(`delete from wallet_ledger_entries where id = ?`, [entryId]),
    ).rejects.toThrow();
  });
});