import { OutboxMessage } from '../../domain/messaging/outbox-message';

export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');

export interface OutboxRepository {
  findPendingDue(now: Date, limit: number): Promise<OutboxMessage[]>;
  lockPendingBatch(limit: number): Promise<OutboxMessage[]>;
  save(message: OutboxMessage): Promise<void>;
  markPublished(id: string): Promise<void>;
  scheduleRetry(id: string, attempts: number, nextAttemptAt: Date): Promise<void>;
}