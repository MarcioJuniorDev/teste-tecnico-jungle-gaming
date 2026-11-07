import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  LedgerCursor,
  LedgerPage,
  LedgerRepository,
  LedgerSum,
} from '../../../application/ports/ledger.repository';
import { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry';
import { LedgerDirection } from '../../../domain/ledger/ledger-direction';
import { Money } from '../../../domain/money/money';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity';
import { WalletLedgerEntryMapper } from '../mappers/wallet-ledger-entry.mapper';

@Injectable()
export class MikroOrmLedgerRepository implements LedgerRepository {
  constructor(private readonly em: EntityManager) { }

  async save(entry: WalletLedgerEntry): Promise<void> {
    this.em.persist(WalletLedgerEntryMapper.toEntity(entry));
    await this.em.flush();
  }

  async findPage(
    walletId: string,
    cursor: string | null,
    limit: number,
  ): Promise<LedgerPage> {
    const decoded = cursor ? this.decodeCursor(cursor) : null;
    const qb = this.em.createQueryBuilder(WalletLedgerEntryEntity, 'e');
    qb.where({ walletId });
    if (decoded) {
      qb.andWhere({
        $or: [
          { createdAt: { $gt: decoded.createdAt } },
          {
            createdAt: decoded.createdAt,
            id: { $gt: decoded.id },
          },
        ],
      });
    }
    qb.orderBy({ createdAt: 'asc', id: 'asc' });
    qb.limit(limit + 1);

    const rows = await qb.getResultList();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map((r) => WalletLedgerEntryMapper.toDomain(r));
    const nextCursor =
      hasMore && page.length > 0
        ? this.encodeCursor({
          createdAt: page[page.length - 1].createdAt,
          id: page[page.length - 1].id,
        })
        : null;

    return { items, nextCursor };
  }

  async sumByWallet(walletId: string, currency: string): Promise<LedgerSum> {
    const rows = await this.em.find(WalletLedgerEntryEntity, { walletId });
    let total = Money.zero(currency);
    for (const row of rows) {
      const value = Money.from({
        amount: row.money.amount,
        currency: row.money.currency,
      });
      total =
        row.direction === LedgerDirection.Credit
          ? total.add(value)
          : total.subtract(value);
    }
    return { total, count: rows.length };
  }

  private encodeCursor(cursor: LedgerCursor): string {
    return Buffer.from(
      JSON.stringify({
        createdAt: cursor.createdAt.toISOString(),
        id: cursor.id,
      }),
    ).toString('base64');
  }

  private decodeCursor(cursor: string): LedgerCursor {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
      if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
        throw new Error('invalid cursor');
      }
      return { createdAt: new Date(parsed.createdAt), id: parsed.id };
    } catch {
      throw new Error('invalid cursor');
    }
  }
}