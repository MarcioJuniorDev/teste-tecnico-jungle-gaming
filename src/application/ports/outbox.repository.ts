import { OutboxMessage } from '../../domain/messaging/outbox-message';

export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');

export interface OutboxRepository {
  findPendingDue(now: Date, limit: number): Promise<OutboxMessage[]>;
  save(message: OutboxMessage): Promise<void>;
}