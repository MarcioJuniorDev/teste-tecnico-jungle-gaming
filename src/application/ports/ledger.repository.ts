import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry';
import { Money } from '../../domain/money/money';

export const LEDGER_REPOSITORY = Symbol('LEDGER_REPOSITORY');

export interface LedgerCursor {
  createdAt: Date;
  id: string;
}

export interface LedgerPage {
  items: WalletLedgerEntry[];
  nextCursor: string | null;
}

export interface LedgerSum {
  total: Money;
  count: number;
}

export interface LedgerRepository {
  save(entry: WalletLedgerEntry): Promise<void>;
  findPage(
    walletId: string,
    cursor: string | null,
    limit: number,
  ): Promise<LedgerPage>;
  sumByWallet(walletId: string, currency: string): Promise<LedgerSum>;
}