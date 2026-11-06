export class IdempotencyConflictError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`idempotency key conflict: ${idempotencyKey}`);
    this.name = 'IdempotencyConflictError';
  }
}