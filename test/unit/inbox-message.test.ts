import { describe, expect, test } from 'bun:test';
import { InboxMessage } from '../../src/domain/messaging/inbox-message';
import { InvalidTransactionStateError } from '../../src/domain/shared/invalid-transaction-state-error';

const baseProps = {
  messageId: 'msg-1',
  consumerName: 'wager-consumer',
  payloadHash: 'hash-1',
};

describe('InboxMessage', () => {
  test('receive starts unprocessed', () => {
    const msg = InboxMessage.receive(baseProps);
    expect(msg.isProcessed()).toBe(false);
    expect(msg.processedAt).toBeUndefined();
  });

  test('markProcessed sets processedAt and isProcessed', () => {
    const msg = InboxMessage.receive(baseProps);
    const at = new Date();
    msg.markProcessed(at);
    expect(msg.isProcessed()).toBe(true);
    expect(msg.processedAt).toBe(at);
  });

  test('markProcessed twice throws', () => {
    const msg = InboxMessage.receive(baseProps);
    msg.markProcessed(new Date());
    expect(() => msg.markProcessed(new Date())).toThrow(InvalidTransactionStateError);
  });

  test('receive rejects missing fields', () => {
    expect(() => InboxMessage.receive({ ...baseProps, messageId: '' })).toThrow();
    expect(() => InboxMessage.receive({ ...baseProps, consumerName: '' })).toThrow();
    expect(() => InboxMessage.receive({ ...baseProps, payloadHash: '' })).toThrow();
  });

  test('rehydrate restores state', () => {
    const at = new Date('2020-01-01');
    const msg = InboxMessage.rehydrate({ ...baseProps, receivedAt: at, processedAt: at });
    expect(msg.isProcessed()).toBe(true);
    expect(msg.receivedAt).toBe(at);
  });
});