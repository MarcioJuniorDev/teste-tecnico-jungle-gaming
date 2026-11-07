import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Harness, bootstrapHarness } from '../helpers/concurrency-harness';
import { assertLedgerConsistent } from '../helpers/assert-ledger-consistent';
import { Money } from '../../src/domain/money/money';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction-kind';
import { WagerTransactionStatus } from '../../src/domain/wagering/wager-transaction-status';
import { WalletEntity } from '../../src/infra/persistence/entities/wallet.entity';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe('Concorrência: PENDING_REFERENCE', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await bootstrapHarness();
    const em = h.orm.em.fork();
    await em.execute('truncate table wallet_ledger_entries, wager_transactions, wallets, inbox_messages, outbox_messages cascade');
  });

  afterAll(async () => {
    await h.close();
  });

  test('REFUND antes da BET → PENDING_REFERENCE → PROCESSED depois', async () => {
    const playerId = randomUUID();
    const wallet = await h.createWallet.execute({
      playerId,
      initialBalance: brl('100.00').toJSON(),
      correlationId: randomUUID(),
    });
    const walletId = wallet.id;

    const refund = await h.processTransaction.execute({
      providerId: 'provider-a',
      externalTransactionId: 'ext-refund-1',
      idempotencyKey: 'provider-a:ext-refund-1',
      playerId,
      walletId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Refund,
      money: brl('10.00').toJSON(),
      referenceExternalTransactionId: 'ext-bet-1',
      correlationId: randomUUID(),
    });

    expect(refund.status).toBe(WagerTransactionStatus.PendingReference);

    const bet = await h.processTransaction.execute({
      providerId: 'provider-a',
      externalTransactionId: 'ext-bet-1',
      idempotencyKey: 'provider-a:ext-bet-1',
      playerId,
      walletId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: brl('10.00').toJSON(),
      correlationId: randomUUID(),
    });
    expect(bet.status).toBe(WagerTransactionStatus.Processed);

    // Reprocessa o REFUND manualmente (o worker faria isso em produção)
    const refundAfter = await h.processTransaction.execute({
      providerId: 'provider-a',
      externalTransactionId: 'ext-refund-1',
      idempotencyKey: 'provider-a:ext-refund-1',
      playerId,
      walletId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Refund,
      money: brl('10.00').toJSON(),
      referenceExternalTransactionId: 'ext-bet-1',
      correlationId: randomUUID(),
      reprocess: true,
    });

    expect(refundAfter.status).toBe(WagerTransactionStatus.Processed);

    const em = h.orm.em.fork();
    const w = await em.findOne(WalletEntity, { id: walletId });
    expect(Number(w!.balance.amount)).toBe(100);

    await assertLedgerConsistent(em, walletId);
  });
});