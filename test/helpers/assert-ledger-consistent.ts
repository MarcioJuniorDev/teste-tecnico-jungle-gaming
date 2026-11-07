import { MikroORM } from '@mikro-orm/postgresql';
import { EntityManager } from '@mikro-orm/postgresql';
import { WalletEntity } from '../../src/infra/persistence/entities/wallet.entity';
import { WalletLedgerEntryEntity } from '../../src/infra/persistence/entities/wallet-ledger-entry.entity';
import { LedgerDirection } from '../../src/domain/ledger/ledger-direction';

export async function assertLedgerConsistent(
  em: EntityManager,
  walletId: string,
): Promise<void> {
  const wallet = await em.findOne(WalletEntity, { id: walletId });
  if (!wallet) throw new Error(`wallet ${walletId} not found`);

  const entries = await em.find(WalletLedgerEntryEntity, { walletId });
  let total = 0;
  for (const e of entries) {
    const amount = Number(e.money.amount);
    total += e.direction === LedgerDirection.Credit ? amount : -amount;
  }

  const stored = Number(wallet.balance.amount);
  if (Math.abs(stored - total) > 0.001) {
    throw new Error(
      `ledger inconsistent for wallet ${walletId}: stored=${stored} calculated=${total}`,
    );
  }
}