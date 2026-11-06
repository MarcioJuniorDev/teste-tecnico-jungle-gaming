import { InboxMessage } from '../../domain/messaging/inbox-message';

export const INBOX_REPOSITORY = Symbol('INBOX_REPOSITORY');

export interface InboxRepository {
  findByConsumerAndMessage(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null>;
  save(message: InboxMessage): Promise<void>;
}