import { Money } from '../../../domain/money/money';
import { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry';
import { LedgerDirection } from '../../../domain/ledger/ledger-direction';
import { MoneyEmbeddable } from '../entities/money.embeddable';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity';

export class WalletLedgerEntryMapper {
  static toEntity(entry: WalletLedgerEntry): WalletLedgerEntryEntity {
    const entity = new WalletLedgerEntryEntity();
    entity.id = entry.id;
    entity.walletId = entry.walletId;
    entity.transactionId = entry.transactionId;
    entity.direction = entry.direction;
    entity.money = new MoneyEmbeddable(entry.money.toJSON().amount, entry.money.currency);
    entity.balanceBefore = new MoneyEmbeddable(
      entry.balanceBefore.toJSON().amount,
      entry.balanceBefore.currency,
    );
    entity.balanceAfter = new MoneyEmbeddable(
      entry.balanceAfter.toJSON().amount,
      entry.balanceAfter.currency,
    );
    entity.createdAt = entry.createdAt;
    return entity;
  }

  static toDomain(entity: WalletLedgerEntryEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: entity.id,
      walletId: entity.walletId,
      transactionId: entity.transactionId,
      direction: entity.direction as LedgerDirection,
      money: Money.from({ amount: entity.money.amount, currency: entity.money.currency }),
      balanceBefore: Money.from({
        amount: entity.balanceBefore.amount,
        currency: entity.balanceBefore.currency,
      }),
      balanceAfter: Money.from({
        amount: entity.balanceAfter.amount,
        currency: entity.balanceAfter.currency,
      }),
      createdAt: entity.createdAt,
    });
  }
}