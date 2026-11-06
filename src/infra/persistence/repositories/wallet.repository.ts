import { Injectable } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { WalletRepository } from '../../../application/ports/wallet.repository';
import { Wallet } from '../../../domain/wallet/wallet';
import { WalletEntity } from '../entities/wallet.entity';
import { WalletMapper } from '../mappers/wallet.mapper';

@Injectable()
export class MikroOrmWalletRepository implements WalletRepository {
  constructor(private readonly em: EntityManager) { }

  async findById(id: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, { id });
    return entity ? WalletMapper.toDomain(entity) : null;
  }

  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(
      WalletEntity,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    return entity ? WalletMapper.toDomain(entity) : null;
  }

  async save(wallet: Wallet): Promise<void> {
    const entity = WalletMapper.toEntity(wallet);
    const managed = await this.em.findOne(WalletEntity, { id: wallet.id });
    if (managed) {
      this.em.assign(managed, entity, { mergeObjectProperties: true });
    } else {
      this.em.persist(entity);
    }
    await this.em.flush();
  }
}