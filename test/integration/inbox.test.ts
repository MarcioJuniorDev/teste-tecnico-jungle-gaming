import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { setupIntegrationDb, teardownIntegrationDb } from './setup';
import { createWallet } from '../helpers/integration-harness';
import { InboxMessageEntity } from '../../src/infra/persistence/entities/inbox-message.entity';

describe('Inbox (deduplicação)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await setupIntegrationDb();
  });

  afterAll(async () => {
    await teardownIntegrationDb();
  });

  test('mesma mensagem duas vezes → 1 inbox processado', async () => {
    const em = orm.em.fork();
    const messageId = crypto.randomUUID();
    const consumerName = 'wager-consumer';

    await em.execute(
      `insert into inbox_messages (consumer_name, message_id, payload_hash, received_at, processed_at)
       values (?, ?, 'hash', now(), now())`,
      [consumerName, messageId],
    );

    await expect(
      em.execute(
        `insert into inbox_messages (consumer_name, message_id, payload_hash, received_at, processed_at)
         values (?, ?, 'hash', now(), now())`,
        [consumerName, messageId],
      ),
    ).rejects.toThrow();

    const rows = await em.find(InboxMessageEntity, { consumerName, messageId });
    expect(rows.length).toBe(1);
    expect(rows[0].processedAt).not.toBeNull();
  });
});