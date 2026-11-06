import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  UnprocessableEntityException,
  UsePipes,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProcessWagerTransactionUseCase } from '../../../application/use-cases/process-wager-transaction/process-wager-transaction.use-case';
import { WagerTransactionStatus } from '../../../domain/wagering/wager-transaction-status';
import { submitWagerTransactionSchema } from '../dtos/submit-wager-transaction.dto';
import type { SubmitWagerTransactionDto } from '../dtos/submit-wager-transaction.dto';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { createWalletSchema } from '../dtos/create-wallet.dto';
import type { CreateWalletDto } from '../dtos/create-wallet.dto';

@Controller('wagering/transactions')
export class WagerTransactionController {
  constructor(private readonly useCase: ProcessWagerTransactionUseCase) { }

  @Post()
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
}