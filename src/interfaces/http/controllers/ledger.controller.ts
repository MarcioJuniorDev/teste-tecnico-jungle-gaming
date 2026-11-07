import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { WALLET_REPOSITORY } from '../../../application/ports/wallet.repository';
import type { WalletRepository } from '../../../application/ports/wallet.repository';
import { LEDGER_REPOSITORY } from '../../../application/ports/ledger.repository';
import type { LedgerRepository } from '../../../application/ports/ledger.repository';

@Controller('wallets/:walletId/ledger')
export class LedgerController {
  constructor(
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository,
  ) {}

  @Get()
  async list(
    @Param('walletId', new ParseUUIDPipe()) walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const wallet = await this.wallets.findById(walletId);
    if (!wallet) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'WALLET_NOT_FOUND',
        message: `wallet ${walletId} not found`,
      });
    }

    const limit = this.parseLimit(limitRaw);
    const page = await this.ledger.findPage(walletId, cursor ?? null, limit);

    return {
      items: page.items.map((entry) => ({
        id: entry.id,
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt,
      })),
      nextCursor: page.nextCursor,
    };
  }

  private parseLimit(raw?: string): number {
    if (!raw) return 50;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) return 50;
    return Math.min(n, 100);
  }
}