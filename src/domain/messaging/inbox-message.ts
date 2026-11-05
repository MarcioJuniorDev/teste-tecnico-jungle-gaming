import { DomainError } from '../shared/domain-error';
import { InvalidTransactionStateError } from '../shared/invalid-transaction-state-error';
import { InboxMessageState } from './inbox-message-state';

export interface ReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt?: Date;
}

export class InboxMessage {
  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    private _processedAt?: Date,
  ) {}

  static receive(props: ReceiveInboxProps): InboxMessage {
    if (!props.messageId) throw new DomainError('messageId is required');
    if (!props.consumerName) throw new DomainError('consumerName is required');
    if (!props.payloadHash) throw new DomainError('payloadHash is required');
    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      props.receivedAt ?? new Date(),
    );
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  markProcessed(at: Date): void {
    if (this.isProcessed()) {
      throw new InvalidTransactionStateError(
        `inbox message ${this.messageId} is already processed`,
      );
    }
    this._processedAt = at;
  }
}