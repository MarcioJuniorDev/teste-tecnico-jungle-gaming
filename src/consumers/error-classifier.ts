import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransactionStatus } from '../domain/wagering/wager-transaction-status';
import { ProcessWagerTransactionResult } from '../application/use-cases/process-wager-transaction/process-wager-transaction.result';

export type ErrorKind = 'transient' | 'permanent';

const TRANSIENT_ERRORS = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '57P01', // admin_shutdown
  '53300', // too_many_connections
];

export function classifyError(err: unknown): ErrorKind {
  if (!(err instanceof Error)) return 'transient';
  const code = (err as { code?: string }).code;
  if (code && TRANSIENT_ERRORS.includes(code)) return 'transient';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'transient';
  if (/timeout|ECONN|deadlock|serialization/i.test(err.message)) return 'transient';
  return 'permanent';
}

export function classifyResult(
  result: ProcessWagerTransactionResult,
): 'ack' {
  // REJECTED e PENDING_REFERENCE são terminais para o consumer: ack.
  // PROCESSED também: ack.
  return 'ack';
}