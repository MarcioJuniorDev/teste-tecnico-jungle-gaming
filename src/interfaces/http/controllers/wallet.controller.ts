import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UsePipes,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateWalletUseCase } from '../../../application/use-cases/create-wallet/create-wallet.use-case';
import { createWalletSchema } from '../dtos/create-wallet.dto';
import type { CreateWalletDto } from '../dtos/create-wallet.dto';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

@Controller('wallets')
export class WalletController {
  constructor(private readonly createWallet: CreateWalletUseCase) { }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(createWalletSchema))
  async create(@Body() dto: CreateWalletDto) {
    return this.createWallet.execute({
      playerId: dto.playerId,
      initialBalance: dto.initialBalance,
      correlationId: randomUUID(),
    });
  }
}