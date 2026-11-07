import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { setupIntegrationDb, teardownIntegrationDb } from './setup';
import { Wallet } from '../../src/domain/wallet/wallet';
import { Money } from '../../src/domain/money/money';
import { WalletMapper } from '../../src/infra/persistence/mappers/wallet.mapper';
import { WalletEntity } from '../../src/infra/persistence/entities/wallet.entity';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe('WalletRepository (integração)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await setupIntegrationDb();
  });

  afterAll(async () => {
    await teardownIntegrationDb();
  });

  test('salva e busca wallet', async () => {
    const em = orm.em.fork();
    const wallet = Wallet.open({
      id: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      initialBalance: brl('100.00'),
    });

    em.persist(WalletMapper.toEntity(wallet));
    await em.flush();
    em.clear();

    const found = await em.findOne(WalletEntity, { id: wallet.id });
    expect(found).not.toBeNull();
    const domain = WalletMapper.toDomain(found!);
    expect(domain.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
  });
});