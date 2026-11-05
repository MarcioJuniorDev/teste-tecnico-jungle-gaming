import { DomainError } from '../shared/domain-error';
import { InvalidTransactionStateError } from '../shared/invalid-transaction-state-error';
import { IntegrationEvent } from './integration-event';
import { OutboxMessageState } from './outbox-message-state';

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 300_000;
const JITTER_RATIO = 0.2;

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    const envelope = event.toJSON();
    return new OutboxMessage(
      envelope.eventId,
      envelope.aggregateId,
      envelope.eventType,
      envelope as unknown as Readonly<Record<string, unknown>>,
      event.occurredAt,
      0,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    if (!this.isPending()) return false;
    const due = this._nextAttemptAt ?? this.occurredAt;
    return due.getTime() <= now.getTime();
  }

  markPublished(at: Date): void {
    if (!this.isPending()) {
      throw new InvalidTransactionStateError(
        `outbox message ${this.id} is already published`,
      );
    }
    this._publishedAt = at;
  }

  scheduleRetry(now: Date): void {
    if (!this.isPending()) {
      throw new InvalidTransactionStateError(
        `outbox message ${this.id} is already published`,
      );
    }
    this._attempts += 1;
    const exponential = BASE_DELAY_MS * Math.pow(2, this._attempts - 1);
    const capped = Math.min(exponential, MAX_DELAY_MS);
    const jitter = capped * JITTER_RATIO * (Math.random() * 2 - 1);
    this._nextAttemptAt = new Date(now.getTime() + capped + jitter);
  }
}