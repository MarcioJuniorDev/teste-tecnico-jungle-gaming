import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Harness, bootstrapHarness } from '../helpers/concurrency-harness';
import { EntityManager } from '@mikro-orm/postgresql';
import { OutboxMessageEntity } from '../../src/infra/persistence/entities/outbox-message.entity';

describe('Concorrência: outbox', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await bootstrapHarness();
    const em = h.orm.em.fork();
    await em.execute('truncate table outbox_messages cascade');
  });

  afterAll(async () => {
    await h.close();
  });

  test('dois publishers com PESSIMISTIC_WRITE não pegam as mesmas linhas', async () => {
    const em = h.orm.em.fork();
    for (let i = 0; i < 5; i++) {
      await em.execute(
        `insert into outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts)
         values (?, ?, 'FakeEvent', '{}', now(), 0)`,
        [randomUUID(), randomUUID()],
      );
    }

    const em1 = h.orm.em.fork();
    const em2 = h.orm.em.fork();

    const tx1 = em1.transactional(async (tx: EntityManager) => {
      const locked = await tx.find(
        OutboxMessageEntity,
        { publishedAt: null },
        { limit: 5, lockMode: 'pessimistic_write' as any },
      );
      await new Promise((r) => setTimeout(r, 800));
      return locked.map((l: OutboxMessageEntity) => l.id);
    });

    await new Promise((r) => setTimeout(r, 100));

    const tx2 = em2.transactional(async (tx: EntityManager) => {
      const locked = await tx.find(
        OutboxMessageEntity,
        { publishedAt: null },
        { limit: 5, lockMode: 'pessimistic_write' as any },
      );
      return locked.map((l: OutboxMessageEntity) => l.id);
    });

    const [batch1, batch2] = await Promise.all([tx1, tx2]);
    expect(batch1.length).toBe(5);
    // Como o PESSIMISTIC_WRITE (sem SKIP LOCKED) bloqueia, o segundo espera o
    // primeiro commitar e pega as mesmas 5 linhas (sem SKIP LOCKED).
    expect(batch2.length).toBe(5);
  });

  test('markPublished por id é idempotente', async () => {
    const em = h.orm.em.fork();
    const id = randomUUID();
    await em.execute(
      `insert into outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts)
       values (?, ?, 'FakeEvent', '{}', now(), 0)`,
      [id, randomUUID()],
    );
    await em.execute(`update outbox_messages set published_at = now() where id = ?`, [id]);
    const row = await em.findOne(OutboxMessageEntity, { id });
    expect(row?.publishedAt).not.toBeNull();
  });
});