import { MikroORM } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import { Wallet } from '../../src/domain/wallet/wallet';
import { Money } from '../../src/domain/money/money';
import { WalletMapper } from '../../src/infra/persistence/mappers/wallet.mapper';
import { WagerTransaction } from '../../src/domain/wagering/wager-transaction';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction-kind';
import { WagerTransactionMapper } from '../../src/infra/persistence/mappers/wager-transaction.mapper';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

export async function createWallet(
  orm: MikroORM,
  playerId: string = randomUUID(),
  initial = '100.00',
): Promise<{ walletId: string; playerId: string }> {
  const em = orm.em.fork();
  const wallet = Wallet.open({
    id: randomUUID(),
    playerId,
    initialBalance: brl(initial),
  });
  em.persist(WalletMapper.toEntity(wallet));
  await em.flush();
  return { walletId: wallet.id, playerId: wallet.playerId };
}

export async function createTransaction(
  orm: MikroORM,
  walletId: string,
  playerId: string,
  kind: WagerTransactionKind,
  amount: string,
  opts: { externalId?: string; referenceExternalId?: string; status?: string } = {},
): Promise<WagerTransaction> {
  const em = orm.em.fork();
  const tx = WagerTransaction.create({
    id: randomUUID(),
    providerId: 'provider-a',
    externalTransactionId: opts.externalId ?? `ext-${randomUUID()}`,
    idempotencyKey: `provider-a:${opts.externalId ?? randomUUID()}`,
    payloadHash: `hash-${randomUUID()}`,
    walletId,
    playerId,
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: brl(amount),
    referenceExternalTransactionId: opts.referenceExternalId,
  });
  if (opts.status === 'REJECTED') {
    tx.reject('INSUFFICIENT_FUNDS' as any);
  } else if (opts.status === 'PENDING_REFERENCE') {
    tx.markPendingReference();
  } else {
    tx.markProcessed(undefined, new Date());
  }
  em.persist(WagerTransactionMapper.toEntity(tx));
  await em.flush();
  return tx;
}   