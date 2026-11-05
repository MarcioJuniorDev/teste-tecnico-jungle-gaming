import { describe, expect, test } from 'bun:test';
import { OutboxMessage } from '../../src/domain/messaging/outbox-message';
import {
  IntegrationEvent,
  IntegrationEventProps,
} from '../../src/domain/messaging/integration-event';
import { InvalidTransactionStateError } from '../../src/domain/shared/invalid-transaction-state-error';

class FakeEvent extends IntegrationEvent<{ foo: string }> {
  readonly eventType = 'FakeEvent';
  readonly version = 1;

  constructor(props: IntegrationEventProps<{ foo: string }>) {
    super(props);
  }
}

const makeEvent = () =>
  new FakeEvent({
    eventId: 'evt-1',
    aggregateId: 'agg-1',
    correlationId: 'corr-1',
    causationId: 'cause-1',
    occurredAt: new Date('2020-01-01T00:00:00.000Z'),
    data: { foo: 'bar' },
  });

describe('OutboxMessage', () => {
  test('enqueue starts pending with attempts 0', () => {
    const outbox = OutboxMessage.enqueue(makeEvent());
    expect(outbox.isPending()).toBe(true);
    expect(outbox.attempts).toBe(0);
    expect(outbox.publishedAt).toBeUndefined();
    expect(outbox.id).toBe('evt-1');
    expect(outbox.eventType).toBe('FakeEvent');
  });

  test('isDue considers occurredAt when no retry scheduled', () => {
    const outbox = OutboxMessage.enqueue(makeEvent());
    expect(outbox.isDue(new Date('2019-12-31T23:59:59.000Z'))).toBe(false);
    expect(outbox.isDue(new Date('2020-01-02T00:00:00.000Z'))).toBe(true);
  });

  test('scheduleRetry increments attempts and sets nextAttemptAt', () => {
    const outbox = OutboxMessage.enqueue(makeEvent());
    const now = new Date('2020-01-01T00:00:00.000Z');
    outbox.scheduleRetry(now);
    expect(outbox.attempts).toBe(1);
    expect(outbox.nextAttemptAt).toBeInstanceOf(Date);
    expect(outbox.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  test('markPublished sets publishedAt and stops pending', () => {
    const outbox = OutboxMessage.enqueue(makeEvent());
    outbox.markPublished(new Date());
    expect(outbox.isPending()).toBe(false);
    expect(outbox.publishedAt).toBeInstanceOf(Date);
  });

  test('markPublished twice throws', () => {
    const outbox = OutboxMessage.enqueue(makeEvent());
    outbox.markPublished(new Date());
    expect(() => outbox.markPublished(new Date())).toThrow(InvalidTransactionStateError);
  });

  test('scheduleRetry after published throws', () => {
    const outbox = OutboxMessage.enqueue(makeEvent());
    outbox.markPublished(new Date());
    expect(() => outbox.scheduleRetry(new Date())).toThrow(InvalidTransactionStateError);
  });

  test('rehydrate restores state', () => {
    const outbox = OutboxMessage.rehydrate({
      id: 'evt-1',
      aggregateId: 'agg-1',
      eventType: 'FakeEvent',
      payload: {},
      occurredAt: new Date('2020-01-01'),
      attempts: 3,
      nextAttemptAt: new Date('2020-01-02'),
      publishedAt: undefined,
    });
    expect(outbox.attempts).toBe(3);
    expect(outbox.isPending()).toBe(true);
  });
});