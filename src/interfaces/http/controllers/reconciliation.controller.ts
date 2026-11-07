import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ReconcileWalletUseCase } from '../../../application/use-cases/reconcile-wallet/reconcile-wallet.use-case';

@Controller('wallets/:walletId/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconcile: ReconcileWalletUseCase) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async reconcileWallet(
    @Param('walletId', new ParseUUIDPipe()) walletId: string,
  ) {
    return this.reconcile.execute({ walletId });
  }
}