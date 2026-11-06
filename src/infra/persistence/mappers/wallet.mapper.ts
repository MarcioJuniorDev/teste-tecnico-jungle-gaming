import { Money } from '../../../domain/money/money';
import { Wallet } from '../../../domain/wallet/wallet';
import { MoneyEmbeddable } from '../entities/money.embeddable';
import { WalletEntity } from '../entities/wallet.entity';

export class WalletMapper {
  static toEntity(wallet: Wallet): WalletEntity {
    const entity = new WalletEntity();
    entity.id = wallet.id;
    entity.playerId = wallet.playerId;
    entity.currency = wallet.currency;
    entity.balance = new MoneyEmbeddable(wallet.balance.toJSON().amount, wallet.currency);
    entity.version = wallet.version;
    entity.createdAt = wallet.createdAt;
    entity.updatedAt = wallet.updatedAt;
    return entity;
  }

  static toDomain(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: Money.from({
        amount: entity.balance.amount,
        currency: entity.balance.currency,
      }),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }
}