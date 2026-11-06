import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry';

export const LEDGER_REPOSITORY = Symbol('LEDGER_REPOSITORY');

export interface LedgerRepository {
  save(entry: WalletLedgerEntry): Promise<void>;
}