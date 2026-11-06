import { MoneyProps } from '../../../domain/money/money';

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: MoneyProps;
  correlationId: string;
}