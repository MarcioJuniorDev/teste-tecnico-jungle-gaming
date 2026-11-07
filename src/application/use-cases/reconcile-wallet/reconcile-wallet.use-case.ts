import { Inject, Injectable, Logger } from '@nestjs/common';
import { WALLET_REPOSITORY } from '../../ports/wallet.repository';
import type { WalletRepository } from '../../ports/wallet.repository';
import { LEDGER_REPOSITORY } from '../../ports/ledger.repository';
import type { LedgerRepository } from '../../ports/ledger.repository';
import { ReconcileWalletCommand } from './reconcile-wallet.command';
import { ReconcileWalletResult } from './reconcile-wallet.result';
import { WalletNotFoundError } from './reconcile-wallet.errors';

@Injectable()
export class ReconcileWalletUseCase {
  private readonly logger = new Logger(ReconcileWalletUseCase.name);

  constructor(
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository,
  ) {}

  async execute(
    command: ReconcileWalletCommand,
  ): Promise<ReconcileWalletResult> {
    const wallet = await this.wallets.findById(command.walletId);
    if (!wallet) {
      throw new WalletNotFoundError(command.walletId);
    }

    const { total, count } = await this.ledger.sumByWallet(
      wallet.id,
      wallet.currency,
    );

    const stored = wallet.balance;
    const difference = stored.subtract(total);
    const consistent = difference.isZero();

    if (!consistent) {
      this.logger.error(
        `reconciliation mismatch wallet=${wallet.id} stored=${stored.toString()} calculated=${total.toString()} diff=${difference.toString()}`,
      );
    }

    return {
      walletId: wallet.id,
      storedBalance: stored.toJSON(),
      calculatedBalance: total.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries: count,
    };
  }
}