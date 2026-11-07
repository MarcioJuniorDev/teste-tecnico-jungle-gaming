import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UsePipes,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateWalletUseCase } from '../../../application/use-cases/create-wallet/create-wallet.use-case';
import { WALLET_REPOSITORY } from '../../../application/ports/wallet.repository';
import type { WalletRepository } from '../../../application/ports/wallet.repository';
import { createWalletSchema } from '../dtos/create-wallet.dto';
import type { CreateWalletDto } from '../dtos/create-wallet.dto';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
  ) { }

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

  @Get(':id')
  async findById(@Param('id', new ParseUUIDPipe()) id: string) {
    const wallet = await this.wallets.findById(id);
    if (!wallet) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'WALLET_NOT_FOUND',
        message: `wallet ${id} not found`,
      });
    }
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }
}