import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { DomainError } from '../../../domain/shared/domain-error';
import { InvalidMoneyError } from '../../../domain/shared/invalid-money-error';
import { InvalidTransactionStateError } from '../../../domain/shared/invalid-transaction-state-error';
import { IdempotencyConflictError } from '../../../application/use-cases/process-wager-transaction/process-wager-transaction.errors';
import { WalletAlreadyExistsError } from '../../../application/use-cases/create-wallet/create-wallet.errors';

type Mapped = { status: number; error: string };

@Catch(
  DomainError,
  InvalidMoneyError,
  InvalidTransactionStateError,
  IdempotencyConflictError,
  WalletAlreadyExistsError,
)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = this.map(exception);

    if (exception instanceof IdempotencyConflictError) {
      response.status(mapped.status).json({
        statusCode: mapped.status,
        error: mapped.error,
        message: exception.message,
        idempotencyKey: exception.idempotencyKey,
      });
      return;
    }

    if (exception instanceof WalletAlreadyExistsError) {
      response.status(mapped.status).json({
        statusCode: mapped.status,
        error: mapped.error,
        message: exception.message,
        playerId: exception.playerId,
        currency: exception.currency,
      });
      return;
    }

    response.status(mapped.status).json({
      statusCode: mapped.status,
      error: mapped.error,
      message: exception.message,
    });
  }

  private map(exception: Error): Mapped {
    if (exception instanceof IdempotencyConflictError) {
      return { status: HttpStatus.CONFLICT, error: 'IDEMPOTENCY_CONFLICT' };
    }
    if (exception instanceof WalletAlreadyExistsError) {
      return { status: HttpStatus.CONFLICT, error: 'WALLET_ALREADY_EXISTS' };
    }
    if (exception instanceof InvalidMoneyError) {
      return { status: HttpStatus.BAD_REQUEST, error: 'INVALID_MONEY' };
    }
    if (exception instanceof InvalidTransactionStateError) {
      return { status: HttpStatus.CONFLICT, error: 'INVALID_TRANSACTION_STATE' };
    }
    return { status: HttpStatus.BAD_REQUEST, error: 'DOMAIN_ERROR' };
  }
}