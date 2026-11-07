import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
  UsePipes,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProcessWagerTransactionUseCase } from '../../../application/use-cases/process-wager-transaction/process-wager-transaction.use-case';
import { WAGER_TRANSACTION_REPOSITORY } from '../../../application/ports/wager-transaction.repository';
import type { WagerTransactionRepository } from '../../../application/ports/wager-transaction.repository';
import { WagerTransactionStatus } from '../../../domain/wagering/wager-transaction-status';
import { submitWagerTransactionSchema } from '../dtos/submit-wager-transaction.dto';
import type { SubmitWagerTransactionDto } from '../dtos/submit-wager-transaction.dto';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { WagerTransaction } from '../../../domain/wagering/wager-transaction';

@Controller()
export class WagerTransactionController {
  constructor(
    private readonly useCase: ProcessWagerTransactionUseCase,
    @Inject(WAGER_TRANSACTION_REPOSITORY)
    private readonly transactions: WagerTransactionRepository,
  ) { }

  @Post('wagering/transactions')
  @UsePipes(new ZodValidationPipe(submitWagerTransactionSchema))
  async submit(
    @Body() dto: SubmitWagerTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required',
      });
    }

    const result = await this.useCase.execute({
      ...dto,
      idempotencyKey,
      correlationId: randomUUID(),
    });

    if (result.status === WagerTransactionStatus.Rejected) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'BUSINESS_REJECTION',
        failureCode: result.failureCode,
        transactionId: result.transactionId,
      });
    }

    if (result.status === WagerTransactionStatus.PendingReference) {
      throw new HttpException(
        {
          statusCode: 202,
          error: 'PENDING_REFERENCE',
          transactionId: result.transactionId,
        },
        HttpStatus.ACCEPTED,
      );
    }

    return {
      statusCode: result.idempotentReplay ? 200 : 201,
      transactionId: result.transactionId,
      status: result.status,
      balance: result.balance,
      idempotentReplay: result.idempotentReplay,
    };
  }

  @Get('wagering/transactions/:id')
  async findById(@Param('id', new ParseUUIDPipe()) id: string) {
    const tx = await this.transactions.findById(id);
    if (!tx) throw this.notFound(id);
    return this.toResponse(tx);
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async findByProviderAndExternalId(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    const tx = await this.transactions.findByProviderAndExternalId(
      providerId,
      externalTransactionId,
    );
    if (!tx) throw this.notFound(`${providerId}:${externalTransactionId}`);
    return this.toResponse(tx);
  }

  private notFound(identifier: string): NotFoundException {
    return new NotFoundException({
      statusCode: 404,
      error: 'TRANSACTION_NOT_FOUND',
      message: `transaction ${identifier} not found`,
    });
  }

  private toResponse(tx: WagerTransaction) {
    return {
      transactionId: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      referenceTransactionId: tx.referenceTransactionId,
      status: tx.status,
      failureCode: tx.failureCode,
      createdAt: tx.createdAt,
      processedAt: tx.processedAt,
    };
  }
}