import { MoneyProps } from '../../../domain/money/money';

export interface CreateWalletResult {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}