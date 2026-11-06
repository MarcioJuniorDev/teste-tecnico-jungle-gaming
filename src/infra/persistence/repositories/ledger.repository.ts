import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { LedgerRepository } from '../../../application/ports/ledger.repository';
import { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry';
import { WalletLedgerEntryMapper } from '../mappers/wallet-ledger-entry.mapper';

@Injectable()
export class MikroOrmLedgerRepository implements LedgerRepository {
  constructor(private readonly em: EntityManager) {}

  async save(entry: WalletLedgerEntry): Promise<void> {
    this.em.persist(WalletLedgerEntryMapper.toEntity(entry));
    await this.em.flush();
  }
}